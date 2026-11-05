import { expect, test } from "vitest";
import { parseAppEnv, parsePort, parsePanelCredentials } from "./env.js";

test("panel credentials need a user and a password of at least 12 characters", () => {
  expect(parsePanelCredentials("admin", "twelve chars")).toEqual({ user: "admin", password: "twelve chars" });
  for (const [user, password] of [[undefined, "twelve chars"], ["", "twelve chars"], ["admin", undefined], ["admin", ""], ["admin", "eleven char"]]) {
    expect(() => parsePanelCredentials(user, password)).toThrow(/PANEL_/);
  }
});

test("a password of only spaces is refused", () => {
  expect(() => parsePanelCredentials("admin", " ".repeat(20))).toThrow(/PANEL_PASSWORD/);
});

test("credentials too long to fit in a login request are refused", () => {
  expect(parsePanelCredentials("a".repeat(256), "b".repeat(256))).toEqual({ user: "a".repeat(256), password: "b".repeat(256) });
  expect(() => parsePanelCredentials("a".repeat(257), "twelve chars")).toThrow(/PANEL_USER/);
  expect(() => parsePanelCredentials("admin", "b".repeat(257))).toThrow(/PANEL_PASSWORD/);
});

test("the example password from .env.example is refused", () => {
  expect(() => parsePanelCredentials("admin", "change-me-to-a-long-random-password")).toThrow(/PANEL_PASSWORD/);
});

test("the error never contains the password", () => {
  expect(() => parsePanelCredentials("admin", "short")).not.toThrow(/short/);
});

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
