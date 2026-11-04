import { HttpError, type RawApi } from "grammy";
import type { Transformer } from "grammy";

// grammY's HttpError nests the fetch error, whose message holds the request URL and so the bot token.
// Replacing it keeps the error an HttpError (polling still retries) but safe to log anywhere.
export function stripRequestDetails(token: string): Transformer<RawApi> {
  return async (prev, method, payload, signal) => {
    try {
      return await prev(method, payload, signal);
    } catch (e) {
      if (e instanceof HttpError) throw new HttpError(e.message.split(token).join("<token>"), undefined);
      throw e;
    }
  };
}
