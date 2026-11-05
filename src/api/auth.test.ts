import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { getPanelAccount, hashPassword, saveAccount, verifyPassword } from "../auth/account.js";
import { insertChat } from "../db/chats.js";
import { type Db, openDatabase } from "../db/connection.js";
import { type ApiTelegram, createApi } from "./app.js";

const USER = "admin";
const PASSWORD = "correct horse battery";
const FAST = { N: 2, r: 1, p: 1 };
const CHAT = -100;
let db: Db;
let clock: number;

const account = (password = PASSWORD, mustChangePassword = false) =>
  saveAccount(db, { username: USER, passwordHash: hashPassword(password, FAST), mustChangePassword }, clock);

const make = (options: { panelDir?: string; panelHost?: string; appEnv?: "development" | "production" } = {}) => createApi({
  db, telegram: {} as ApiTelegram, appEnv: options.appEnv ?? "development", botUsername: () => "mi_bot",
  onMessageQueued: vi.fn(), fetchPhoto: vi.fn(async () => null), now: () => clock,
  panelDir: options.panelDir, panelHost: options.panelHost,
});
let app: ReturnType<typeof make>;

beforeEach(() => {
  db = openDatabase(":memory:");
  insertChat(db, { id: CHAT, type: "supergroup", title: "Grupo", username: null }, []);
  clock = 1_000_000_000_000;
  account();
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
const login = (username = USER, password = PASSWORD, headers?: Record<string, string>, target = app) =>
  send("POST", "/api/auth/login", { username, password }, headers, target);
const changePassword = (session: Record<string, string>, currentPassword: string, newPassword: string) =>
  send("POST", "/api/auth/password", { currentPassword, newPassword }, session);
const cookieOf = (r: Response) => r.headers.get("Set-Cookie")!.split(";")[0]!;
const asSession = (cookie: string) => ({ Cookie: cookie });
const tick = () => new Promise((resolve) => setImmediate(resolve));

// A request whose headers have arrived but whose body has not, as a slow or deliberate client would send it.
function held(path: string, body: unknown, headers: Record<string, string> = {}) {
  let release!: () => void;
  const stream = new ReadableStream({
    start(controller) {
      release = () => {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));
        controller.close();
      };
    },
  });
  const request = new Request(`http://ignored${path}`, {
    method: "POST", headers: { Host: "bot.localhost", "Content-Type": "application/json", ...headers }, body: stream, duplex: "half",
  } as RequestInit);
  return { response: Promise.resolve(app.request(request)), release: () => release() };
}
const heldLogin = (username: string, password: string) => held("/api/auth/login", { username, password });

test.each([
  ["wrong password", USER, "wrong password here"],
  ["wrong user", "someone", PASSWORD],
  ["both wrong", "someone", "wrong password here"],
  ["empty", "", ""],
])("%s gives the same 401 and no cookie", async (_name, username, password) => {
  const r = await login(username, password);
  expect(r.status).toBe(401);
  expect(await r.json()).toEqual({ error: "Wrong username or password" });
  expect(r.headers.get("Set-Cookie")).toBeNull();
});

test("without an account nobody can log in, and a leftover session opens nothing", async () => {
  const session = asSession(cookieOf(await login()));
  db.exec("DELETE FROM panel_account");
  expect((await login()).status).toBe(401);
  expect((await send("GET", "/api/chats", undefined, session)).status).toBe(401);
  expect(await (await send("GET", "/api/auth/session", undefined, session)).json()).toEqual({ authenticated: false, mustChangePassword: false });
});

test("a good login sets a strict, HTTP-only session cookie for 30 days", async () => {
  const r = await login();
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ authenticated: true, mustChangePassword: false });
  const [value, ...attributes] = r.headers.get("Set-Cookie")!.split("; ");
  expect(value).toMatch(/^panel_session=[A-Za-z0-9_-]{43}$/);
  expect(attributes.sort()).toEqual(["HttpOnly", "Max-Age=2592000", "Path=/", "SameSite=Strict"]);
});

test("the cookie is Secure behind HTTPS", async () => {
  const r = await login(undefined, undefined, { "X-Forwarded-Proto": "https" });
  expect(r.headers.get("Set-Cookie")).toContain("Secure");
});

test("the database holds only a hash of the token", async () => {
  const token = cookieOf(await login()).split("=")[1]!;
  const row = db.prepare("SELECT * FROM panel_sessions").get() as Record<string, unknown>;
  expect(Object.keys(row).sort()).toEqual(["created_at", "expires_at", "token_hash"]);
  expect(row.token_hash).toBe(createHash("sha256").update(token).digest("hex"));
});

test("the session endpoint reports the state, and a session opens the API", async () => {
  expect(await (await send("GET", "/api/auth/session")).json()).toEqual({ authenticated: false, mustChangePassword: false });
  expect((await send("GET", "/api/chats")).status).toBe(401);
  const session = asSession(cookieOf(await login()));
  expect(await (await send("GET", "/api/auth/session", undefined, session)).json()).toEqual({ authenticated: true, mustChangePassword: false });
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

test.each(["panel_session=forged", "panel_session=", "other=1", `panel_session=${"a".repeat(43)}`])("a forged cookie %j gives 401", async (Cookie) => {
  expect((await send("GET", "/api/chats", undefined, { Cookie })).status).toBe(401);
});

test("the stored hash of a session does not work as a session", async () => {
  await login();
  const { token_hash: hash } = db.prepare("SELECT token_hash FROM panel_sessions").get() as { token_hash: string };
  expect((await send("GET", "/api/chats", undefined, { Cookie: `panel_session=${hash}` })).status).toBe(401);
});

test("while the initial password is unchanged, every route but changing it and the public ones is refused", async () => {
  account(PASSWORD, true);
  const r = await login();
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ authenticated: true, mustChangePassword: true });
  const session = asSession(cookieOf(r));
  expect(await (await send("GET", "/api/auth/session", undefined, session)).json()).toEqual({ authenticated: true, mustChangePassword: true });

  const ALLOWED = new Set(["GET /api/health", "GET /api/auth/session", "POST /api/auth/login", "POST /api/auth/logout", "POST /api/auth/password"]);
  const routes = app.routes.filter((route) => route.method !== "ALL" && !ALLOWED.has(`${route.method} ${route.path}`));
  expect(routes.length).toBeGreaterThan(25);
  for (const route of routes) {
    const path = route.path.replace(/:id\{[^}]*\}/, String(CHAT)).replace(/:[a-zA-Z]+(\{[^}]*\})?/g, "1");
    const res = await send(route.method, path, route.method === "GET" || route.method === "DELETE" ? undefined : {}, session);
    expect(`${route.method} ${path} ${res.status}`).toBe(`${route.method} ${path} 403`);
  }
  expect(await (await send("GET", "/api/chats", undefined, session)).json()).toEqual({ error: "Change the initial password first" });
  expect((await send("GET", "/api/nope", undefined, session)).status).toBe(403);
  expect((await send("POST", "/api/auth/logout", undefined, session)).status).toBe(204);
});

test("changing the initial password opens the panel, and the old password stops working", async () => {
  account(PASSWORD, true);
  const session = asSession(cookieOf(await login()));
  const r = await changePassword(session, PASSWORD, "a brand new password");
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ authenticated: true, mustChangePassword: false });
  expect(getPanelAccount(db)!.mustChangePassword).toBe(false);

  expect((await send("GET", "/api/chats", undefined, asSession(cookieOf(r)))).status).toBe(200);
  expect((await login()).status).toBe(401);
  expect((await login(USER, "a brand new password")).status).toBe(200);
});

test("changing the password replaces this browser's session and ends every other", async () => {
  const mine = asSession(cookieOf(await login()));
  const other = asSession(cookieOf(await login()));
  const r = await changePassword(mine, PASSWORD, "a brand new password");
  const renewed = asSession(cookieOf(r));
  expect(r.headers.get("Set-Cookie")).toContain("HttpOnly");
  expect(renewed.Cookie).not.toBe(mine.Cookie);
  expect((await send("GET", "/api/chats", undefined, renewed)).status).toBe(200);
  expect((await send("GET", "/api/chats", undefined, mine)).status).toBe(401);
  expect((await send("GET", "/api/chats", undefined, other)).status).toBe(401);
});

test("going back to an earlier password does not revive its sessions", async () => {
  const old = asSession(cookieOf(await login()));
  const renewed = asSession(cookieOf(await changePassword(old, PASSWORD, "a brand new password")));
  await changePassword(renewed, "a brand new password", PASSWORD);
  expect((await send("GET", "/api/chats", undefined, old)).status).toBe(401);
});

test("the password is stored with the real scrypt cost", async () => {
  const session = asSession(cookieOf(await login()));
  await changePassword(session, PASSWORD, "a brand new password");
  const stored = getPanelAccount(db)!.passwordHash;
  expect(stored).toMatch(/^scrypt\$131072\$8\$1\$/);
  expect(verifyPassword(stored, "a brand new password")).toBe(true);
});

test("changing the password needs a session", async () => {
  expect((await changePassword({}, PASSWORD, "a brand new password")).status).toBe(401);
  expect((await login()).status).toBe(200);
});

test("changing the password obeys the Origin guard", async () => {
  const session = asSession(cookieOf(await login()));
  const r = await changePassword({ ...session, Origin: "https://evil.example" }, PASSWORD, "a brand new password");
  expect(r.status).toBe(403);
  expect(verifyPassword(getPanelAccount(db)!.passwordHash, PASSWORD)).toBe(true);
});

test.each([
  ["too short", "eleven char", "at least 12"],
  ["too long", "b".repeat(257), "at most 256"],
  ["the same as now", PASSWORD, "different"],
])("a new password that is %s is refused and changes nothing", async (_name, newPassword, message) => {
  const session = asSession(cookieOf(await login()));
  const r = await changePassword(session, PASSWORD, newPassword);
  expect(r.status).toBe(400);
  expect((await r.json() as { error: string }).error).toContain(message);
  expect(verifyPassword(getPanelAccount(db)!.passwordHash, PASSWORD)).toBe(true);
  expect((await send("GET", "/api/chats", undefined, session)).status).toBe(200);
});

test("a wrong current password changes nothing and counts toward the limit", async () => {
  const session = asSession(cookieOf(await login()));
  for (let i = 0; i < 10; i++) {
    const r = await changePassword(session, "wrong guess", "a brand new password");
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "The current password is wrong" });
  }
  expect((await changePassword(session, PASSWORD, "a brand new password")).status).toBe(429);
  expect((await login()).status).toBe(429);
  expect(verifyPassword(getPanelAccount(db)!.passwordHash, PASSWORD)).toBe(true);
});

test("a change held open across the lockout is blocked when its body arrives", async () => {
  const session = asSession(cookieOf(await login()));
  const change = held("/api/auth/password", { currentPassword: PASSWORD, newPassword: "a brand new password" }, session);
  await tick();
  for (let i = 0; i < 10; i++) await login(USER, "wrong");
  change.release();
  expect((await change.response).status).toBe(429);
  expect(verifyPassword(getPanelAccount(db)!.passwordHash, PASSWORD)).toBe(true);
});

test("after 10 failures logins are blocked for 15 minutes, even with the right password", async () => {
  for (let i = 0; i < 10; i++) expect((await login(USER, "wrong")).status).toBe(401);
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
  const pending = heldLogin(USER, PASSWORD);
  await tick();
  for (let i = 0; i < 10; i++) expect((await login(USER, "wrong")).status).toBe(401);
  pending.release();
  expect((await pending.response).status).toBe(429);
});

test("guesses delivered together are counted one by one, so the right one after the limit fails", async () => {
  const guesses = Array.from({ length: 30 }, (_, i) => heldLogin(USER, i === 25 ? PASSWORD : "wrong"));
  await tick();
  for (const guess of guesses) guess.release();
  const statuses = await Promise.all(guesses.map(async (guess) => (await guess.response).status));
  expect(statuses.filter((s) => s === 401)).toHaveLength(10);
  expect(statuses.filter((s) => s === 429)).toHaveLength(20);
});

test("the lockout is logged once, without any credentials", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  for (let i = 0; i < 9; i++) await login(USER, "guess-number-nine");
  expect(warn).not.toHaveBeenCalled();
  await login(USER, "guess-number-ten");
  expect(warn).toHaveBeenCalledOnce();
  expect(JSON.stringify(warn.mock.calls)).not.toMatch(/guess-number|correct horse/);
  await login();
  expect(warn).toHaveBeenCalledOnce();
  warn.mockRestore();
});

test.each([
  ["with a declared size", { "Content-Length": "5000" }],
  ["without a declared size", {}],
])("a login body over the limit %s gives 400 and does not count as a guess", async (_name, headers) => {
  const huge = JSON.stringify({ username: USER, password: "x".repeat(5000) });
  for (let i = 0; i < 12; i++) expect((await send("POST", "/api/auth/login", huge, headers)).status).toBe(400);
  expect((await login()).status).toBe(200);
});

test("a change body over the limit gives 400", async () => {
  const session = asSession(cookieOf(await login()));
  const huge = JSON.stringify({ currentPassword: PASSWORD, newPassword: "x".repeat(5000) });
  expect((await send("POST", "/api/auth/password", huge, session)).status).toBe(400);
});

test("a good login clears the failure count, and a live session keeps working while blocked", async () => {
  for (let i = 0; i < 9; i++) await login(USER, "wrong");
  const session = asSession(cookieOf(await login()));
  for (let i = 0; i < 9; i++) expect((await login(USER, "wrong")).status).toBe(401);
  await login(USER, "wrong");
  expect((await login()).status).toBe(429);
  expect((await send("GET", "/api/chats", undefined, session)).status).toBe(200);
});

test.each([
  ["malformed JSON", "{nope"],
  ["missing password", { username: USER }],
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
    const list = (target: typeof app) => target.routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(list(make({ panelDir: dir, appEnv: "production" }))).toEqual(["ALL /*", ...list(app)].sort());
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

test("the longest password allowed fits in a login and in a change", async () => {
  const longest = "\u0001".repeat(256);
  account(longest);
  const r = await login(USER, longest);
  expect(JSON.stringify({ username: USER, password: longest }).length).toBeGreaterThan(1500);
  expect(r.status).toBe(200);
  const other = "\u0002".repeat(256);
  expect(JSON.stringify({ currentPassword: longest, newPassword: other }).length).toBeGreaterThan(3000);
  expect((await changePassword(asSession(cookieOf(r)), longest, other)).status).toBe(200);
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
  const onDomain = make({ appEnv: "production", panelHost: "panel.example.com" });
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
