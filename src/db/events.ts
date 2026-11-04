import type { Db } from "./connection.js";
import type { FilterAction } from "./chats.js";

export type FilterName = "link" | "word" | "flood" | "bot";
export type SenderType = "user" | "chat";
export interface EventRecord {
  id: number; chatId: number; senderType: SenderType; senderId: number; senderName: string;
  filter: FilterName; matched: string; text: string | null; action: FilterAction;
  deleteOk: boolean | null; banOk: boolean | null; error: string | null;
  dryRun: boolean; unbannedAt: number | null; createdAt: number;
}
export type NewEvent = Omit<EventRecord, "id" | "unbannedAt" | "createdAt">;

const MAX_TEXT = 1000;
const RETENTION_SECONDS = 90 * 86400;

type Row = Record<string, number | string | null>;

const nullableBool = (v: number | string | null): boolean | null => (v === null ? null : v === 1);

function toRecord(r: Row): EventRecord {
  return {
    id: r.id as number, chatId: r.chat_id as number,
    senderType: r.sender_type as SenderType, senderId: r.sender_id as number, senderName: r.sender_name as string,
    filter: r.filter as FilterName, matched: r.matched as string, text: r.text as string | null,
    action: r.action as FilterAction,
    deleteOk: nullableBool(r.delete_ok!), banOk: nullableBool(r.ban_ok!), error: r.error as string | null,
    dryRun: r.dry_run === 1, unbannedAt: r.unbanned_at as number | null, createdAt: r.created_at as number,
  };
}

const bit = (v: boolean | null): number | null => (v === null ? null : v ? 1 : 0);

export function insertEvent(db: Db, event: NewEvent, now: number = Math.floor(Date.now() / 1000)): EventRecord {
  const text = event.text === null ? null : event.text.slice(0, MAX_TEXT);
  const info = db.prepare(
    `INSERT INTO moderation_events (chat_id, sender_type, sender_id, sender_name, filter, matched, text, action,
       delete_ok, ban_ok, error, dry_run, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event.chatId, event.senderType, event.senderId, event.senderName, event.filter, event.matched, text, event.action,
    bit(event.deleteOk), bit(event.banOk), event.error, event.dryRun ? 1 : 0, now,
  );
  return getEvent(db, event.chatId, Number(info.lastInsertRowid))!;
}

export function getEvent(db: Db, chatId: number, id: number): EventRecord | undefined {
  const row = db.prepare("SELECT * FROM moderation_events WHERE chat_id = ? AND id = ?").get(chatId, id) as Row | undefined;
  return row && toRecord(row);
}

export function listEvents(db: Db, chatId: number, opts: { limit: number; before?: number }): EventRecord[] {
  const rows = db.prepare("SELECT * FROM moderation_events WHERE chat_id = ? AND id < ? ORDER BY id DESC LIMIT ?")
    .all(chatId, opts.before ?? Number.MAX_SAFE_INTEGER, opts.limit) as Row[];
  return rows.map(toRecord);
}

export function isActiveBan(event: EventRecord): boolean {
  return event.banOk === true && !event.dryRun && event.unbannedAt === null;
}

const ACTIVE_BAN_SQL = "COALESCE(ban_ok, 0) = 1 AND dry_run = 0 AND unbanned_at IS NULL";

export function markUnbanned(db: Db, chatId: number, senderType: SenderType, senderId: number, at: number): void {
  db.prepare(`UPDATE moderation_events SET unbanned_at = ? WHERE chat_id = ? AND sender_type = ? AND sender_id = ? AND ${ACTIVE_BAN_SQL}`)
    .run(at, chatId, senderType, senderId);
}

export function purgeEvents(db: Db, now: number): number {
  const cutoff = now - RETENTION_SECONDS;
  return db.transaction(() => {
    const removed = db.prepare(`DELETE FROM moderation_events WHERE created_at < ? AND NOT (${ACTIVE_BAN_SQL})`).run(cutoff).changes;
    db.prepare(`UPDATE moderation_events SET text = NULL WHERE created_at < ? AND ${ACTIVE_BAN_SQL}`).run(cutoff);
    return removed;
  })();
}
