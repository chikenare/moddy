import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { insertChat } from "../db/chats.js";
import { type Db, openDatabase } from "../db/connection.js";
import { type ApiTelegram, createApi } from "./app.js";

const CREDENTIALS = { user: "owner", password: "correct horse battery" };
const CHAT = -100;
let db: Db;
let clock: number;

const make = (credentials = CREDENTIALS) => createApi({
  db, telegram: {} as ApiTelegram, appEnv: "development", botUsername: () => "mi_bot",
  onMessageQueued: vi.fn(), fetchPhoto: vi.fn(async () => null), credentials, now: () => clock,
});
let app: ReturnType<typeof make>;

beforeEach(() => {
  db = openDatabase(":memory:");
  insertChat(db, { id: CHAT, type: "supergroup", title: "Grupo", username: null }, []);
  clock = 1_000_000_000_000;
  app = make();
});

function send(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, target = app) {
  const init: RequestInit = { method, headers: { Host: "bot.localhost", ...headers } };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  return target.request(`http://ignored${path}`, init);
}
const login = (username = CREDENTIALS.user, password = CREDENTIALS.password, headers?: Record<string, string>, target = app) =>
  send("POST", "/api/auth/login", { username, password }, headers, target);
const cookieOf = (r: Response) => r.headers.get("Set-Cookie")!.split(";")[0]!;
const asSession = (cookie: string) => ({ Cookie: cookie });
const tick = () => new Promise((resolve) => setImmediate(resolve));

// A login whose headers have arrived but whose body has not, as a slow or deliberate client would send it.
function heldLogin(username: string, password: string) {
  let release!: () => void;
  const body = new ReadableStream({
    start(controller) {
      release = () => {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ username, password })));
        controller.close();
      };
    },
  });
  const request = new Request("http://ignored/api/auth/login", {
    method: "POST", headers: { Host: "bot.localhost", "Content-Type": "application/json" }, body, duplex: "half",
  } as RequestInit);
  return { response: Promise.resolve(app.request(request)), release: () => release() };
}

test.each([
  ["wrong password", "owner", "wrong password here"],
  ["wrong user", "someone", "correct horse battery"],
  ["both wrong", "someone", "wrong password here"],
  ["empty", "", ""],
])("%s gives the same 401 and no cookie", async (_name, username, password) => {
  const r = await login(username, password);
  expect(r.status).toBe(401);
  expect(await r.json()).toEqual({ error: "Wrong username or password" });
  expect(r.headers.get("Set-Cookie")).toBeNull();
});

test("a good login sets a strict, HTTP-only session cookie for 30 days", async () => {
  const r = await login();
  expect(r.status).toBe(200);
  const [value, ...attributes] = r.headers.get("Set-Cookie")!.split("; ");
  expect(value).toMatch(/^panel_session=[A-Za-z0-9_-]{43}$/);
  expect(attributes.sort()).toEqual(["HttpOnly", "Max-Age=2592000", "Path=/", "SameSite=Strict"]);
});

test("the cookie is Secure behind HTTPS", async () => {
  const r = await login(undefined, undefined, { "X-Forwarded-Proto": "https" });
  expect(r.headers.get("Set-Cookie")).toContain("Secure");
});

test("the database holds a keyed hash of the token and nothing to test a password against", async () => {
  const token = cookieOf(await login()).split("=")[1]!;
  const row = db.prepare("SELECT * FROM panel_sessions").get() as Record<string, unknown>;
  expect(Object.keys(row).sort()).toEqual(["created_at", "expires_at", "token_hash"]);
  expect(row.token_hash).not.toBe(token);
  expect(row.token_hash).not.toBe(createHash("sha256").update(token).digest("hex"));
});

test("the session endpoint reports the state, and a session opens the API", async () => {
  expect(await (await send("GET", "/api/auth/session")).json()).toEqual({ authenticated: false });
  expect((await send("GET", "/api/chats")).status).toBe(401);
  const session = asSession(cookieOf(await login()));
  expect(await (await send("GET", "/api/auth/session", undefined, session)).json()).toEqual({ authenticated: true });
  expect((await send("GET", "/api/chats", undefined, session)).status).toBe(200);
});

test("logout ends the session on the server, not just in the browser", async () => {
  const session = asSession(cookieOf(await login()));
  const out = await send("POST", "/api/auth/logout", undefined, session);
  expect(out.status).toBe(204);
  expect(out.headers.get("Set-Cookie")).toContain("panel_session=;");
  expect((await send("GET", "/api/chats", undefined, session)).status).toBe(401);
});

test("logout without a session is harmless", async () => {
  expect((await send("POST", "/api/auth/logout")).status).toBe(204);
});

test("a session expires after 30 days", async () => {
  const session = asSession(cookieOf(await login()));
  clock += 30 * 86_400_000 - 1000;
  expect((await send("GET", "/api/chats", undefined, session)).status).toBe(200);
  clock += 1000;
  expect((await send("GET", "/api/chats", undefined, session)).status).toBe(401);
});

test("changing the password ends existing sessions", async () => {
  const session = asSession(cookieOf(await login()));
  const changed = make({ user: "owner", password: "a brand new password" });
  expect((await send("GET", "/api/chats", undefined, session, changed)).status).toBe(401);
  expect((await login(CREDENTIALS.user, CREDENTIALS.password, undefined, changed)).status).toBe(401);
  expect((await login("owner", "a brand new password", undefined, changed)).status).toBe(200);
});

test("changing the username ends existing sessions too", async () => {
  const session = asSession(cookieOf(await login()));
  const changed = make({ user: "someone else", password: CREDENTIALS.password });
  expect((await send("GET", "/api/chats", undefined, session, changed)).status).toBe(401);
});

test.each(["panel_session=forged", "panel_session=", "other=1", `panel_session=${"a".repeat(43)}`])("a forged cookie %j gives 401", async (Cookie) => {
  expect((await send("GET", "/api/chats", undefined, { Cookie })).status).toBe(401);
});

test.each([
  ["no username", { user: "", password: "correct horse battery" }],
  ["no password", { user: "owner", password: "" }],
])("the API refuses to start with %s, so an empty login can never match", (_name, credentials) => {
  expect(() => make(credentials)).toThrow(/username and a password/);
});

test("after 10 failures logins are blocked for 15 minutes, even with the right password", async () => {
  for (let i = 0; i < 10; i++) expect((await login("owner", "wrong")).status).toBe(401);
  const blocked = await login();
  expect(blocked.status).toBe(429);
  expect(await blocked.json()).toEqual({ error: "Too many attempts. Try again in 15 minutes." });
  expect(blocked.headers.get("Retry-After")).toBe("900");
  clock += 15 * 60_000 - 1000;
  const lastSecond = await login();
  expect(lastSecond.status).toBe(429);
  expect(await lastSecond.json()).toEqual({ error: "Too many attempts. Try again in 1 minute." });
  clock += 1000;
  expect((await login()).status).toBe(200);
});

test("a login held open across the lockout is blocked when its body arrives", async () => {
  const held = heldLogin(CREDENTIALS.user, CREDENTIALS.password);
  await tick();
  for (let i = 0; i < 10; i++) expect((await login("owner", "wrong")).status).toBe(401);
  held.release();
  expect((await held.response).status).toBe(429);
});

test("guesses delivered together are counted one by one, so the right one after the limit fails", async () => {
  const guesses = Array.from({ length: 30 }, (_, i) => heldLogin("owner", i === 25 ? CREDENTIALS.password : "wrong"));
  await tick();
  for (const guess of guesses) guess.release();
  const statuses = await Promise.all(guesses.map(async (guess) => (await guess.response).status));
  expect(statuses.filter((s) => s === 401)).toHaveLength(10);
  expect(statuses.filter((s) => s === 429)).toHaveLength(20);
});

test("the lockout is logged once, without any credentials", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  for (let i = 0; i < 9; i++) await login("owner", "guess-number-nine");
  expect(warn).not.toHaveBeenCalled();
  await login("owner", "guess-number-ten");
  expect(warn).toHaveBeenCalledOnce();
  expect(JSON.stringify(warn.mock.calls)).not.toMatch(/owner|guess-number|correct horse/);
  await login();
  expect(warn).toHaveBeenCalledOnce();
  warn.mockRestore();
});

test.each([
  ["with a declared size", { "Content-Length": "5000" }],
  ["without a declared size", {}],
])("a login body over the limit %s gives 400 and does not count as a guess", async (_name, headers) => {
  const huge = JSON.stringify({ username: "owner", password: "x".repeat(5000) });
  for (let i = 0; i < 12; i++) expect((await send("POST", "/api/auth/login", huge, headers)).status).toBe(400);
  expect((await login()).status).toBe(200);
});

test("a good login clears the failure count, and a live session keeps working while blocked", async () => {
  for (let i = 0; i < 9; i++) await login("owner", "wrong");
  const session = asSession(cookieOf(await login()));
  for (let i = 0; i < 9; i++) expect((await login("owner", "wrong")).status).toBe(401);
  await login("owner", "wrong");
  expect((await login()).status).toBe(429);
  expect((await send("GET", "/api/chats", undefined, session)).status).toBe(200);
});

test.each([
  ["malformed JSON", "{nope"],
  ["missing password", { username: "owner" }],
  ["wrong type", { username: 1, password: 2 }],
])("%s gives 400", async (_name, body) => {
  expect((await send("POST", "/api/auth/login", body)).status).toBe(400);
});

test("login obeys the Host and Origin guard", async () => {
  expect((await login(undefined, undefined, { Host: "evil.example" })).status).toBe(403);
  expect((await login(undefined, undefined, { Origin: "https://evil.example" })).status).toBe(403);
});

test("health is public and says nothing about the bot; info needs a session", async () => {
  expect(await (await send("GET", "/api/health")).json()).toEqual({ status: "ok" });
  expect((await send("GET", "/api/info")).status).toBe(401);
  const session = asSession(cookieOf(await login()));
  expect(await (await send("GET", "/api/info", undefined, session)).json()).toEqual({ appEnv: "development", botUsername: "mi_bot" });
});

test("every API route needs a session, except the listed public ones", async () => {
  const PUBLIC = new Set(["GET /api/health", "GET /api/auth/session", "POST /api/auth/login", "POST /api/auth/logout"]);
  // Only the shared middlewares may catch every method, and nothing may live outside /api.
  expect(app.routes.filter((r) => r.method === "ALL").map((r) => r.path).sort()).toEqual(["/*", "/api/*", "/api/*", "/api/chats/:id{-?\\d+}/*"]);
  expect(app.routes.filter((r) => r.method !== "ALL" && !r.path.startsWith("/api/"))).toEqual([]);

  const routes = app.routes.filter((r) => r.method !== "ALL");
  expect(routes.length).toBeGreaterThan(25);
  for (const key of PUBLIC) expect(routes.some((r) => `${r.method} ${r.path}` === key)).toBe(true);

  const protectedRoutes = routes.filter((r) => !PUBLIC.has(`${r.method} ${r.path}`)).map((route) => ({
    method: route.method,
    path: route.path.replace(/:id\{[^}]*\}/, String(CHAT)).replace(/:[a-zA-Z]+(\{[^}]*\})?/g, "1"),
    body: route.method === "GET" || route.method === "DELETE" ? undefined : {},
  }));
  for (const { method, path, body } of protectedRoutes) {
    const r = await send(method, path, body);
    expect(`${method} ${path} ${r.status}`).toBe(`${method} ${path} 401`);
  }

  // With a session each path must reach its handler: a 401 from a path that matches no route would prove nothing.
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  const session = asSession(cookieOf(await login()));
  for (const { method, path, body } of protectedRoutes) {
    const r = await send(method, path, body, session);
    expect(`${method} ${path} ${await r.text()}`).not.toContain("Route not found");
  }
  quiet.mockRestore();
});

test("building with the panel adds no route beyond its own middleware", () => {
  const dir = mkdtempSync(join(tmpdir(), "panel-"));
  try {
    const withPanel = createApi({
      db, telegram: {} as ApiTelegram, appEnv: "production", botUsername: () => null, onMessageQueued: vi.fn(),
      fetchPhoto: vi.fn(async () => null), credentials: CREDENTIALS, now: () => clock, panelDir: dir,
    });
    const list = (target: typeof app) => target.routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(list(withPanel)).toEqual(["ALL /*", ...list(app)].sort());
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("without a session, a chat route says nothing about whether the chat exists", async () => {
  const known = await send("GET", `/api/chats/${CHAT}/words`);
  const unknown = await send("GET", "/api/chats/-999/words");
  expect([known.status, unknown.status]).toEqual([401, 401]);
  expect(await unknown.text()).toBe(await known.text());
});

test("the longest credentials the configuration allows fit in a login request", async () => {
  const longest = "\u0001".repeat(256);
  const target = make({ user: longest, password: longest });
  const r = await login(longest, longest, undefined, target);
  expect(JSON.stringify({ username: longest, password: longest }).length).toBeGreaterThan(3000);
  expect(r.status).toBe(200);
});

test("a client that hangs up in the middle of a login is not logged, so it cannot fill the disk", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const body = new ReadableStream({
    start(controller) {
      controller.error(Object.assign(new Error("aborted"), { code: "ECONNRESET" }));
    },
  });
  await app.request(new Request("http://ignored/api/auth/login", {
    method: "POST", headers: { Host: "bot.localhost", "Content-Type": "application/json" }, body, duplex: "half",
  } as RequestInit));
  expect(error).not.toHaveBeenCalled();
  error.mockRestore();
});

test("other API errors are still logged", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const session = asSession(cookieOf(await login()));
  db.exec("DROP TABLE chat_words");
  expect((await send("GET", `/api/chats/${CHAT}/words`, undefined, session)).status).toBe(500);
  expect(error).toHaveBeenCalled();
  error.mockRestore();
});

test.each(["bot.localhost", "panel.localhost:9000"])("the panel answers on %s", async (Host) => {
  expect((await send("GET", "/api/health", undefined, { Host })).status).toBe(200);
});

test("a domain is refused unless it is the configured panel host", async () => {
  const onDomain = createApi({
    db, telegram: {} as ApiTelegram, appEnv: "production", botUsername: () => null, onMessageQueued: vi.fn(),
    fetchPhoto: vi.fn(async () => null), credentials: CREDENTIALS, now: () => clock, panelHost: "panel.example.com",
  });
  const https = { Host: "panel.example.com", Origin: "https://panel.example.com", "X-Forwarded-Proto": "https" };
  const r = await login(undefined, undefined, https, onDomain);
  expect(r.status).toBe(200);
  expect(r.headers.get("Set-Cookie")).toContain("Secure");

  expect((await login(undefined, undefined, https, app)).status).toBe(403);
  for (const Host of ["evil.example", "panel.example.com.evil.example", "xpanel.example.com"]) {
    expect((await send("GET", "/api/health", undefined, { Host }, onDomain)).status).toBe(403);
  }
  const foreign = { Host: "panel.example.com", Origin: "https://evil.example" };
  expect((await login(undefined, undefined, foreign, onDomain)).status).toBe(403);
});

test.each(["HEAD", "OPTIONS"])("%s on a protected route needs a session too", async (method) => {
  expect((await send(method, "/api/chats")).status).toBe(401);
});

test("unknown API paths give 401 without a session, so they reveal nothing", async () => {
  expect((await send("GET", "/api/nope")).status).toBe(401);
  expect((await send("GET", "/api/auth/login/")).status).toBe(401);
});
