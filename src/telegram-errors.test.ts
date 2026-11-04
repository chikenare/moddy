import { inspect } from "node:util";
import { Bot, HttpError } from "grammy";
import { expect, test } from "vitest";
import { stripRequestDetails } from "./telegram-errors.js";

const TOKEN = "123456:FAKE_TOKEN_FOR_REVIEW";
type Prev = Parameters<ReturnType<typeof stripRequestDetails>>[0];

test("an HttpError loses its nested request error but stays an HttpError", async () => {
  const nested = new Error(`request to https://api.telegram.org/bot${TOKEN}/sendMessage failed`);
  const prev = (async () => { throw new HttpError(`Network request for 'sendMessage' failed! ${nested.message}`, nested); }) as unknown as Prev;
  const caught = await stripRequestDetails(TOKEN)(prev, "sendMessage", {} as never, undefined).catch((e: unknown) => e);
  expect(caught).toBeInstanceOf(HttpError);
  expect(inspect(caught, { depth: null })).not.toContain(TOKEN);
  expect((caught as HttpError).message).toContain("sendMessage");
});

test("other errors and results pass through unchanged", async () => {
  const boom = new Error("boom");
  const failing = (async () => { throw boom; }) as unknown as Prev;
  await expect(stripRequestDetails(TOKEN)(failing, "getMe", {} as never, undefined)).rejects.toBe(boom);
  const ok = (async () => ({ ok: true, result: 1 })) as unknown as Prev;
  await expect(stripRequestDetails(TOKEN)(ok, "getMe", {} as never, undefined)).resolves.toEqual({ ok: true, result: 1 });
});

test("a real Bot with a failing fetch gives a clean error", async () => {
  const bot = new Bot(TOKEN, { client: { apiRoot: "http://127.0.0.1:9", sensitiveLogs: true } });
  bot.api.config.use(stripRequestDetails(TOKEN));
  const caught = await bot.api.sendMessage(1, "hi").catch((e: unknown) => e);
  expect(caught).toBeInstanceOf(HttpError);
  expect(inspect(caught, { depth: null })).not.toContain("FAKE_TOKEN");
});
