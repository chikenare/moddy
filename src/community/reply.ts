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

// Puts the sender's name in front as a text mention, so they are notified even without a @username.
// Anonymous admins and channels post as a chat, so there is nobody to mention.
export function mentionSender(ctx: Context, text: string, entities: FormattedEntity[] = []): { text: string; entities: MessageEntity[] } {
  const from = ctx.msg?.from;
  if (!from || from.is_bot || ctx.msg?.sender_chat) return { text, entities: entities as MessageEntity[] };
  const name = from.first_name;
  const shift = name.length + 1;
  return {
    text: `${name}\n${text}`,
    entities: [
      { type: "text_mention", offset: 0, length: name.length, user: from },
      ...(entities as MessageEntity[]).map((e) => ({ ...e, offset: e.offset + shift })),
    ],
  };
}

// Not awaited: long polling handles updates one at a time, so a slow send must not hold up moderation.
export function replyInBackground(ctx: Context, text: string, entities: (FormattedEntity | MessageEntity)[] = [], onSent?: () => void): void {
  void ctx.reply(text, {
    reply_parameters: { message_id: ctx.msg!.message_id, allow_sending_without_reply: true },
    link_preview_options: { is_disabled: true },
    ...(entities.length ? { entities: entities as MessageEntity[] } : {}),
  }).then(() => onSent?.()).catch((e) => console.error(`Could not reply in chat ${ctx.chat?.id}:`, e));
}
