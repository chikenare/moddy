import type { Context } from "grammy";
import type { MessageEntity } from "grammy/types";
import type { FormattedEntity } from "../db/auto-replies.js";

export const COOLDOWN_MS = 60_000;

export class Cooldown {
  private readonly last = new Map<string, number>();
  private readonly ms: number;
  private readonly now: () => number;

  constructor(ms: number, now: () => number) {
    this.ms = ms;
    this.now = now;
  }

  take(key: string): boolean {
    const at = this.now();
    const previous = this.last.get(key);
    if (previous !== undefined && at - previous < this.ms) return false;
    this.last.set(key, at);
    return true;
  }
}

// Not awaited: long polling handles updates one at a time, so a slow send must not hold up moderation.
export function replyInBackground(ctx: Context, text: string, entities: FormattedEntity[] = []): void {
  void ctx.reply(text, {
    reply_parameters: { message_id: ctx.msg!.message_id, allow_sending_without_reply: true },
    link_preview_options: { is_disabled: true },
    ...(entities.length ? { entities: entities as MessageEntity[] } : {}),
  }).catch((e) => console.error(`Could not reply in chat ${ctx.chat?.id}:`, e));
}
