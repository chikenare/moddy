import { afterEach, beforeEach, expect, test, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("BOT_TOKEN", "000000:test");
  vi.stubEnv("APP_ENV", "development");
  vi.stubEnv("PANEL_USER", "admin");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test("the configuration loads with valid panel credentials", async () => {
  vi.stubEnv("PANEL_PASSWORD", "a long enough password");
  const { config } = await import("./config.js");
  expect(config.panelCredentials).toEqual({ user: "admin", password: "a long enough password" });
});

test.each(["short", "change-me-to-a-long-random-password"])("the configuration refuses the password %j", async (password) => {
  vi.stubEnv("PANEL_PASSWORD", password);
  await expect(import("./config.js")).rejects.toThrow(/PANEL_PASSWORD/);
});
