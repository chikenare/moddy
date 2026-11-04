import { afterEach, expect, test, vi } from "vitest";
import { createPhotoFetcher } from "./photos.js";

const TOKEN = "123456:SECRET-TOKEN";
const bytes = new Uint8Array([1, 2, 3]);

function setup(over: { getChat?: ReturnType<typeof vi.fn>; fetch?: ReturnType<typeof vi.fn> } = {}) {
  let t = 1_000_000;
  const api = {
    getChat: over.getChat ?? vi.fn().mockResolvedValue({ photo: { small_file_id: "F1" } }),
    getFile: vi.fn().mockResolvedValue({ file_path: "photos/a.jpg" }),
  };
  const fetch = over.fetch ?? vi.fn().mockResolvedValue(new Response(bytes));
  const fetcher = createPhotoFetcher({ api: api as never, token: TOKEN, fetch: fetch as never, now: () => t });
  return { api, fetch, fetcher, advance: (ms: number) => { t += ms; } };
}

afterEach(() => vi.restoreAllMocks());

test("returns the photo bytes and serves repeats from the cache for an hour", async () => {
  const { fetcher, api, fetch, advance } = setup();
  expect([...(await fetcher(-5))!]).toEqual([1, 2, 3]);
  expect(api.getFile).toHaveBeenCalledWith("F1");
  expect(fetch).toHaveBeenCalledWith(`https://api.telegram.org/file/bot${TOKEN}/photos/a.jpg`);
  await fetcher(-5);
  expect(api.getChat).toHaveBeenCalledTimes(1);
  advance(60 * 60 * 1000 + 1);
  fetch.mockResolvedValue(new Response(bytes));
  await fetcher(-5);
  expect(api.getChat).toHaveBeenCalledTimes(2);
});

test("a chat without a photo returns null and is cached", async () => {
  const { fetcher, api, fetch } = setup({ getChat: vi.fn().mockResolvedValue({}) });
  expect(await fetcher(-5)).toBeNull();
  expect(await fetcher(-5)).toBeNull();
  expect(api.getChat).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});

test("a Telegram failure returns null and never leaks the token", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const failing = vi.fn().mockRejectedValue(new Error(`request to https://api.telegram.org/file/bot${TOKEN}/x failed`));
  const { fetcher } = setup({ fetch: failing });
  const result = await fetcher(-5);
  expect(result).toBeNull();
  expect(err).toHaveBeenCalled();
  expect(JSON.stringify(err.mock.calls)).not.toContain("SECRET-TOKEN");
  expect(JSON.stringify(result)).not.toContain("SECRET-TOKEN");
});

test("a failed getChat returns null", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { fetcher } = setup({ getChat: vi.fn().mockRejectedValue(new Error("Bad Request: chat not found")) });
  expect(await fetcher(-5)).toBeNull();
});

test("a non-OK download returns null", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { fetcher } = setup({ fetch: vi.fn().mockResolvedValue(new Response("no", { status: 500 })) });
  expect(await fetcher(-5)).toBeNull();
});
