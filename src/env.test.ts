import { expect, test } from "vitest";
import { parseAppEnv, parsePanelHost, parsePort } from "./env.js";

test("the panel host is optional and normalized", () => {
  expect(parsePanelHost(undefined)).toBeNull();
  expect(parsePanelHost("")).toBeNull();
  expect(parsePanelHost("Panel.Example.com")).toBe("panel.example.com");
});

test.each(["https://panel.example.com", "panel.example.com/", "panel.example.com:443", "localhost", "panel example.com", "*.example.com"])(
  "the panel host refuses %j",
  (value) => {
    expect(() => parsePanelHost(value)).toThrow(/PANEL_HOST/);
  },
);

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
