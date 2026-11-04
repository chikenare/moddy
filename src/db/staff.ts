import type { Db } from "./connection.js";

const SEEN_RETENTION_SECONDS = 90 * 24 * 60 * 60;
const nowSeconds = () => Math.floor(Date.now() / 1000);

export interface StaffMember { userId: number; displayName: string; addedAt: number }
export interface SeenUser { userId: number; username: string | null; displayName: string; seenAt: number }

export function listStaff(db: Db, chatId: number): StaffMember[] {
  return db.prepare(
    "SELECT user_id AS userId, display_name AS displayName, added_at AS addedAt FROM chat_staff WHERE chat_id = ? ORDER BY display_name, user_id",
  ).all(chatId) as StaffMember[];
}

export function addStaff(db: Db, chatId: number, userId: number, displayName: string, now = nowSeconds()): void {
  db.prepare(
    `INSERT INTO chat_staff (chat_id, user_id, display_name, added_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (chat_id, user_id) DO UPDATE SET display_name = excluded.display_name`,
  ).run(chatId, userId, displayName, now);
}

export function removeStaff(db: Db, chatId: number, userId: number): boolean {
  return db.prepare("DELETE FROM chat_staff WHERE chat_id = ? AND user_id = ?").run(chatId, userId).changes > 0;
}

export function isStaff(db: Db, chatId: number, userId: number): boolean {
  return db.prepare("SELECT 1 FROM chat_staff WHERE chat_id = ? AND user_id = ?").get(chatId, userId) !== undefined;
}

export function recordSeenUser(
  db: Db,
  chatId: number,
  user: { id: number; username?: string; displayName: string },
  now = nowSeconds(),
): void {
  db.prepare(
    `INSERT INTO chat_seen_users (chat_id, user_id, username, display_name, seen_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (chat_id, user_id) DO UPDATE SET
       username = excluded.username, display_name = excluded.display_name, seen_at = excluded.seen_at`,
  ).run(chatId, user.id, user.username?.toLowerCase() ?? null, user.displayName, now);
}

export function findSeenUser(db: Db, chatId: number, username: string): SeenUser | undefined {
  return db.prepare(
    `SELECT user_id AS userId, username, display_name AS displayName, seen_at AS seenAt
     FROM chat_seen_users WHERE chat_id = ? AND username = ? ORDER BY seen_at DESC LIMIT 1`,
  ).get(chatId, username.toLowerCase()) as SeenUser | undefined;
}

export function purgeSeenUsers(db: Db, now: number): number {
  return db.prepare("DELETE FROM chat_seen_users WHERE seen_at < ?").run(now - SEEN_RETENTION_SECONDS).changes;
}
