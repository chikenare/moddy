import { expect, test } from "vitest";
import { parseAppEnv, parsePort } from "./env.js";

test("acepta los dos entornos", () => {
  expect(parseAppEnv("development")).toBe("development");
  expect(parseAppEnv("production")).toBe("production");
});

test.each([undefined, "", "staging", "PRODUCTION"])("rechaza %s", (v) => {
  expect(() => parseAppEnv(v)).toThrow(/APP_ENV/);
});

test("parsePort: 3000 por defecto y enteros de 1 a 65535", () => {
  expect(parsePort(undefined)).toBe(3000);
  expect(parsePort("1")).toBe(1);
  expect(parsePort("8080")).toBe(8080);
  expect(parsePort("65535")).toBe(65535);
});

test.each(["", "0", "65536", "-1", "abc", "30.5", "3000x", " "])("parsePort rechaza %j", (v) => {
  expect(() => parsePort(v)).toThrow(/API_PORT/);
});
