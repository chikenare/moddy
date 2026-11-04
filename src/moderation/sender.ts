import type { Message } from "grammy/types";
import type { SenderType } from "../db/events.js";

export interface Sender { type: SenderType; id: number; name: string }

export function senderOf(message: Message): Sender {
  if (message.sender_chat) {
    const c = message.sender_chat;
    return { type: "chat", id: c.id, name: c.title ?? (c.username ? `@${c.username}` : String(c.id)) };
  }
  const u = message.from;
  if (!u) return { type: "user", id: 0, name: "desconocido" };
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || (u.username ? `@${u.username}` : String(u.id));
  return { type: "user", id: u.id, name };
}

export function isStructurallyExempt(message: Message, chat: { id: number; linkedChatId: number | null }): boolean {
  if (message.is_automatic_forward) return true;
  const sc = message.sender_chat?.id;
  return sc !== undefined && (sc === chat.id || sc === chat.linkedChatId);
}
