import type { Api } from "grammy";

const HOUR_MS = 60 * 60 * 1000;
// A failure may be temporary, so it is retried sooner than a real answer.
const FAILURE_MS = 60 * 1000;

export type PhotoFetcher = (chatId: number) => Promise<Uint8Array | null>;

export function createPhotoFetcher(deps: {
  api: Pick<Api, "getChat" | "getFile">;
  token: string;
  fetch?: typeof fetch;
  now?: () => number;
}): PhotoFetcher {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const cache = new Map<number, { expires: number; value: Uint8Array | null }>();

  // The download URL contains the token, so only the message is logged, with the token removed.
  const logFailure = (chatId: number, e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`Could not load the photo of chat ${chatId}:`, message.split(deps.token).join("<token>"));
  };

  async function load(chatId: number): Promise<{ value: Uint8Array | null; ttl: number }> {
    try {
      const chat = await deps.api.getChat(chatId);
      const fileId = "photo" in chat ? chat.photo?.small_file_id : undefined;
      if (!fileId) return { value: null, ttl: HOUR_MS };
      const file = await deps.api.getFile(fileId);
      if (!file.file_path) return { value: null, ttl: HOUR_MS };
      const res = await doFetch(`https://api.telegram.org/file/bot${deps.token}/${file.file_path}`);
      if (!res.ok) throw new Error(`Download failed with status ${res.status}`);
      return { value: new Uint8Array(await res.arrayBuffer()), ttl: HOUR_MS };
    } catch (e) {
      logFailure(chatId, e);
      return { value: null, ttl: FAILURE_MS };
    }
  }

  return async (chatId) => {
    const hit = cache.get(chatId);
    if (hit && hit.expires > now()) return hit.value;
    const { value, ttl } = await load(chatId);
    cache.set(chatId, { expires: now() + ttl, value });
    return value;
  };
}
