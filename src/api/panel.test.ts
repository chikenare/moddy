import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { openDatabase } from "../db/connection.js";
import { type ApiTelegram, createApi } from "./app.js";

let base: string;
let withPanel: ReturnType<typeof createApi>;
let withoutPanel: ReturnType<typeof createApi>;

const make = (panelDir?: string | null) =>
  createApi({
    db: openDatabase(":memory:"), telegram: {} as ApiTelegram, appEnv: "development",
    botUsername: () => "mi_bot", onMessageQueued: vi.fn(), fetchPhoto: vi.fn(), panelDir,
  });
const call = (app: ReturnType<typeof createApi>, path: string, init: RequestInit = {}) =>
  app.request(`http://ignored${path}`, { ...init, headers: { Host: "bot.localhost", ...init.headers } });

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "panel-"));
  const dir = join(base, "panel");
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "index.html"), "<html>PANEL</html>");
  writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
  writeFileSync(join(base, "secret"), "TOP SECRET");
  withPanel = make(dir);
  withoutPanel = make();
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

test.each(["/", "/groups", "/chats/-100"])("%s serves the panel HTML without caching", async (path) => {
  const r = await call(withPanel, path);
  expect(r.status).toBe(200);
  expect(await r.text()).toBe("<html>PANEL</html>");
  expect(r.headers.get("Cache-Control")).toBe("no-cache");
});

test("HEAD on a client route gives the HTML headers", async () => {
  const r = await call(withPanel, "/groups", { method: "HEAD" });
  expect(r.status).toBe(200);
  expect(r.headers.get("Cache-Control")).toBe("no-cache");
});

test("hashed assets are immutable and missing assets are 404", async () => {
  const ok = await call(withPanel, "/assets/app.js");
  expect(ok.status).toBe(200);
  expect(await ok.text()).toBe("console.log(1)");
  expect(ok.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  const missing = await call(withPanel, "/assets/missing.js");
  expect(missing.status).toBe(404);
  expect(await missing.text()).not.toContain("PANEL");
});

test.each(["/../secret", "/%2e%2e/secret", "/assets/..%2f..%2fsecret", "/assets/../../secret"])("%s does not escape the panel directory", async (path) => {
  const r = await call(withPanel, path);
  expect(await r.text()).not.toContain("TOP SECRET");
});

test("the API keeps its JSON 404, health and Host guard", async () => {
  const nope = await call(withPanel, "/api/nope");
  expect(nope.status).toBe(404);
  expect(await nope.json()).toEqual({ error: "Route not found" });
  expect((await call(withPanel, "/api/health")).status).toBe(200);
  expect((await call(withPanel, "/api/health", { headers: { Host: "evil.example" } })).status).toBe(403);
});

test("security headers are on panel and API responses", async () => {
  for (const path of ["/", "/assets/app.js", "/api/health", "/api/nope"]) {
    const r = await call(withPanel, path);
    expect(r.headers.get("X-Frame-Options"), path).toBe("DENY");
    expect(r.headers.get("Content-Security-Policy"), path).toBe("frame-ancestors 'none'");
    expect(r.headers.get("X-Content-Type-Options"), path).toBe("nosniff");
    expect(r.headers.get("Referrer-Policy"), path).toBe("same-origin");
  }
  const dev = await call(withoutPanel, "/api/health");
  expect(dev.headers.get("X-Frame-Options")).toBe("DENY");
});

test("without a panel directory other paths give the JSON 404", async () => {
  const r = await call(withoutPanel, "/groups");
  expect(r.status).toBe(404);
  expect(await r.json()).toEqual({ error: "Route not found" });
});
