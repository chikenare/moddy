import { type Server } from "node:http";
import { Hono } from "hono";
import { afterEach, expect, test } from "vitest";
import { startApiServer } from "./server.js";

let server: Server;

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("the server limits how many connections a client can hold and for how long", async () => {
  const app = new Hono();
  app.get("/", (c) => c.text("ok"));
  server = startApiServer(app.fetch, 0);
  await new Promise((resolve) => server.once("listening", resolve));
  expect(server.maxConnections).toBe(256);
  expect(server.requestTimeout).toBe(30_000);
  expect(server.headersTimeout).toBeLessThanOrEqual(30_000);

  const { port } = server.address() as { port: number };
  const r = await fetch(`http://127.0.0.1:${port}/`);
  expect(await r.text()).toBe("ok");
});
