import { afterEach, beforeEach, expect, test, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("BOT_TOKEN", "000000:test");
  vi.stubEnv("APP_ENV", "development");
  vi.stubEnv("PANEL_HOST", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test("the configuration loads without any panel login in the environment", async () => {
  const { config } = await import("./config.js");
  expect(config.panelHost).toBeNull();
  expect(Object.keys(config)).not.toContain("panelCredentials");
});

test("the configuration refuses a panel host that is not a domain", async () => {
  vi.stubEnv("PANEL_HOST", "https://panel.example.com");
  await expect(import("./config.js")).rejects.toThrow(/PANEL_HOST/);
});
