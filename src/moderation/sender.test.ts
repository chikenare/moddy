import type { Message } from "grammy/types";
import { expect, test } from "vitest";
import { isStructurallyExempt, senderOf } from "./sender.js";

const msg = (o: Record<string, unknown>) => ({ message_id: 1, date: 0, chat: { id: -100, type: "supergroup" }, ...o }) as unknown as Message;
const chat = { id: -100, linkedChatId: -200 };

test("usa sender_chat antes que from", () => {
  const s = senderOf(msg({ sender_chat: { id: -300, type: "channel", title: "Canal" }, from: { id: 5, first_name: "A" } }));
  expect(s).toEqual({ type: "chat", id: -300, name: "Canal" });
});

test("usa from con nombre completo", () => {
  expect(senderOf(msg({ from: { id: 5, first_name: "Ana", last_name: "Paz" } }))).toEqual({ type: "user", id: 5, name: "Ana Paz" });
});

test.each([
  ["reenvío automático", { is_automatic_forward: true, sender_chat: { id: -999 } }],
  ["admin anónimo", { sender_chat: { id: -100, type: "supergroup" } }],
  ["canal vinculado", { sender_chat: { id: -200, type: "channel" } }],
])("%s está exento", (_n, m) => {
  expect(isStructurallyExempt(msg(m), chat)).toBe(true);
});

test("otro canal no está exento", () => {
  expect(isStructurallyExempt(msg({ sender_chat: { id: -300, type: "channel" } }), chat)).toBe(false);
  expect(isStructurallyExempt(msg({ from: { id: 5 } }), chat)).toBe(false);
});
