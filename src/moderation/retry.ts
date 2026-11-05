import { GrammyError } from "grammy";

const ATTEMPTS = 3;
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Waits out Telegram's rate limit. Use it inside a per-chat queue, so it delays only that chat.
export async function withRetry<T>(call: () => Promise<T>, sleep: (ms: number) => Promise<void> = defaultSleep): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (e) {
      if (!(e instanceof GrammyError) || e.error_code !== 429 || attempt >= ATTEMPTS) throw e;
      await sleep((e.parameters.retry_after ?? 1) * 1000);
    }
  }
}
