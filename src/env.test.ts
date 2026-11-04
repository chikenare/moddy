import { expect, test } from "vitest";
import { parseAppEnv } from "./env.js";

test("acepta los dos entornos", () => {
  expect(parseAppEnv("development")).toBe("development");
  expect(parseAppEnv("production")).toBe("production");
});

test.each([undefined, "", "staging", "PRODUCTION"])("rechaza %s", (v) => {
  expect(() => parseAppEnv(v)).toThrow(/APP_ENV/);
});
