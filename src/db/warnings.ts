import type { Db } from "./connection.js";

const WARNING_SECONDS = 30 * 86_400;

export function countWarnings(db: Db, chatId: number, senderId: number, now: number): number {
  return db.prepare("SELECT count(*) FROM chat_warnings WHERE chat_id = ? AND sender_id = ? AND created_at > ?")
    .pluck().get(chatId, senderId, now - WARNING_SECONDS) as number;
}

// Returns how many are active now, including this one.
export function addWarning(db: Db, chatId: number, senderId: number, reason: string | null, now: number): number {
  db.prepare("INSERT INTO chat_warnings (chat_id, sender_id, reason, created_at) VALUES (?, ?, ?, ?)").run(chatId, senderId, reason, now);
  return countWarnings(db, chatId, senderId, now);
}

export function clearWarnings(db: Db, chatId: number, senderId: number): void {
  db.prepare("DELETE FROM chat_warnings WHERE chat_id = ? AND sender_id = ?").run(chatId, senderId);
}

export function purgeWarnings(db: Db, now: number): number {
  return db.prepare("DELETE FROM chat_warnings WHERE created_at <= ?").run(now - WARNING_SECONDS).changes;
}
