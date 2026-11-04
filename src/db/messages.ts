import type { FormattedEntity } from "./auto-replies.js";
import type { Db } from "./connection.js";

const RETENTION_SECONDS = 90 * 24 * 60 * 60;
const nowSeconds = () => Math.floor(Date.now() / 1000);

export type TargetStatus = "pending" | "sending" | "sent" | "failed" | "missed" | "cancelled";
export interface MessageTarget { chatId: number; title: string; status: TargetStatus; error: string | null; sentAt: number | null }
export interface ScheduledMessage {
  id: number; text: string; entities: FormattedEntity[]; sendAt: number; createdAt: number; recurringId: number | null; targets: MessageTarget[];
}
export interface DueTarget { messageId: number; chatId: number; text: string; entities: FormattedEntity[]; sendAt: number }

interface Row { id: number; text: string; entities: string; send_at: number; created_at: number; recurring_id: number | null }

function toRecord(db: Db, row: Row): ScheduledMessage {
  const targets = db.prepare(
    `SELECT t.chat_id AS chatId, c.title, t.status, t.error, t.sent_at AS sentAt
     FROM scheduled_message_targets t JOIN chats c ON c.id = t.chat_id
     WHERE t.message_id = ? ORDER BY t.chat_id`,
  ).all(row.id) as MessageTarget[];
  return {
    id: row.id, text: row.text, entities: JSON.parse(row.entities) as FormattedEntity[], sendAt: row.send_at,
    createdAt: row.created_at, recurringId: row.recurring_id, targets,
  };
}

export function getMessage(db: Db, id: number): ScheduledMessage | undefined {
  const row = db.prepare("SELECT * FROM scheduled_messages WHERE id = ?").get(id) as Row | undefined;
  return row && toRecord(db, row);
}

export function listMessages(db: Db, limit = 100): ScheduledMessage[] {
  const rows = db.prepare(
    `SELECT * FROM scheduled_messages m
     WHERE EXISTS (SELECT 1 FROM scheduled_message_targets t WHERE t.message_id = m.id)
     ORDER BY m.id DESC LIMIT ?`,
  ).all(limit) as Row[];
  return rows.map((row) => toRecord(db, row));
}

export function createMessage(
  db: Db, text: string, chatIds: number[], sendAt: number, now = nowSeconds(),
  extra: { entities?: FormattedEntity[]; recurringId?: number } = {},
): ScheduledMessage {
  const id = db.transaction(() => {
    const { lastInsertRowid } = db.prepare("INSERT INTO scheduled_messages (text, entities, send_at, created_at, recurring_id) VALUES (?, ?, ?, ?, ?)")
      .run(text, JSON.stringify(extra.entities ?? []), sendAt, now, extra.recurringId ?? null);
    const target = db.prepare("INSERT INTO scheduled_message_targets (message_id, chat_id, status) VALUES (?, ?, 'pending')");
    for (const chatId of chatIds) target.run(lastInsertRowid, chatId);
    return Number(lastInsertRowid);
  })();
  return getMessage(db, id)!;
}

export function cancelMessage(db: Db, id: number): number {
  return db.prepare("UPDATE scheduled_message_targets SET status = 'cancelled' WHERE message_id = ? AND status = 'pending'")
    .run(id).changes;
}

export function dueTargets(db: Db, now: number): DueTarget[] {
  const rows = db.prepare(
    `SELECT t.message_id AS messageId, t.chat_id AS chatId, m.text, m.entities, m.send_at AS sendAt
     FROM scheduled_message_targets t JOIN scheduled_messages m ON m.id = t.message_id
     WHERE t.status = 'pending' AND m.send_at <= ? ORDER BY m.send_at, t.message_id, t.chat_id`,
  ).all(now) as (Omit<DueTarget, "entities"> & { entities: string })[];
  return rows.map((r) => ({ ...r, entities: JSON.parse(r.entities) as FormattedEntity[] }));
}

export function claimTarget(db: Db, messageId: number, chatId: number, status: "sending" | "missed"): boolean {
  return db.prepare("UPDATE scheduled_message_targets SET status = ? WHERE message_id = ? AND chat_id = ? AND status = 'pending'")
    .run(status, messageId, chatId).changes > 0;
}

export function finishTarget(db: Db, messageId: number, chatId: number, result: { sentAt: number } | { error: string }): void {
  db.prepare("UPDATE scheduled_message_targets SET status = ?, sent_at = ?, error = ? WHERE message_id = ? AND chat_id = ?").run(
    "sentAt" in result ? "sent" : "failed",
    "sentAt" in result ? result.sentAt : null,
    "error" in result ? result.error : null,
    messageId,
    chatId,
  );
}

export function failInterruptedTargets(db: Db): number {
  return db.prepare(
    "UPDATE scheduled_message_targets SET status = 'failed', error = 'Interrupted by a restart: it may or may not have been sent' WHERE status = 'sending'",
  ).run().changes;
}

export function purgeMessages(db: Db, now: number): number {
  return db.prepare(
    `DELETE FROM scheduled_messages
     WHERE id NOT IN (SELECT message_id FROM scheduled_message_targets)
        OR (send_at < ? AND id NOT IN (SELECT message_id FROM scheduled_message_targets WHERE status IN ('pending', 'sending')))`,
  ).run(now - RETENTION_SECONDS).changes;
}
