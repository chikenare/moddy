import type { FormattedEntity } from "./auto-replies.js";
import type { Db } from "./connection.js";
import { createMessage } from "./messages.js";

export interface Recurring {
  id: number; text: string; entities: FormattedEntity[]; cron: string; timezone: string; enabled: boolean;
  nextRunAt: number | null; lastRunAt: number | null; createdAt: number; chats: { id: number; title: string }[];
}
export interface RecurringInput {
  text: string; entities: FormattedEntity[]; cron: string; timezone: string; chatIds: number[]; nextRunAt: number | null;
}

interface Row {
  id: number; text: string; entities: string; cron: string; timezone: string; enabled: number;
  next_run_at: number | null; last_run_at: number | null; created_at: number;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

function toRecord(db: Db, row: Row): Recurring {
  const chats = db.prepare(
    `SELECT c.id, c.title FROM recurring_message_targets t JOIN chats c ON c.id = t.chat_id
     WHERE t.recurring_id = ? ORDER BY c.title, c.id`,
  ).all(row.id) as { id: number; title: string }[];
  return {
    id: row.id, text: row.text, entities: JSON.parse(row.entities) as FormattedEntity[], cron: row.cron, timezone: row.timezone,
    enabled: row.enabled === 1, nextRunAt: row.next_run_at, lastRunAt: row.last_run_at, createdAt: row.created_at, chats,
  };
}

export function getRecurring(db: Db, id: number): Recurring | undefined {
  const row = db.prepare("SELECT * FROM recurring_messages WHERE id = ?").get(id) as Row | undefined;
  return row && toRecord(db, row);
}

export function listRecurring(db: Db): Recurring[] {
  return (db.prepare("SELECT * FROM recurring_messages ORDER BY id DESC").all() as Row[]).map((row) => toRecord(db, row));
}

function setTargets(db: Db, id: number, chatIds: number[]): void {
  db.prepare("DELETE FROM recurring_message_targets WHERE recurring_id = ?").run(id);
  const insert = db.prepare("INSERT INTO recurring_message_targets (recurring_id, chat_id) VALUES (?, ?)");
  for (const chatId of chatIds) insert.run(id, chatId);
}

export function createRecurring(db: Db, input: RecurringInput, now = nowSeconds()): Recurring {
  const id = db.transaction(() => {
    const { lastInsertRowid } = db.prepare(
      "INSERT INTO recurring_messages (text, entities, cron, timezone, next_run_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(input.text, JSON.stringify(input.entities), input.cron, input.timezone, input.nextRunAt, now);
    setTargets(db, Number(lastInsertRowid), input.chatIds);
    return Number(lastInsertRowid);
  })();
  return getRecurring(db, id)!;
}

export function updateRecurring(db: Db, id: number, input: RecurringInput): Recurring | undefined {
  db.transaction(() => {
    const { changes } = db.prepare(
      "UPDATE recurring_messages SET text = ?, entities = ?, cron = ?, timezone = ?, next_run_at = ? WHERE id = ?",
    ).run(input.text, JSON.stringify(input.entities), input.cron, input.timezone, input.nextRunAt, id);
    if (changes) setTargets(db, id, input.chatIds);
  })();
  return getRecurring(db, id);
}

export function setRecurringEnabled(db: Db, id: number, enabled: boolean, nextRunAt: number | null): Recurring | undefined {
  db.prepare("UPDATE recurring_messages SET enabled = ?, next_run_at = ? WHERE id = ?").run(enabled ? 1 : 0, nextRunAt, id);
  return getRecurring(db, id);
}

export function deleteRecurring(db: Db, id: number): boolean {
  return db.prepare("DELETE FROM recurring_messages WHERE id = ?").run(id).changes > 0;
}

export function dueRecurring(db: Db, now: number): Recurring[] {
  const rows = db.prepare(
    "SELECT * FROM recurring_messages WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at, id",
  ).all(now) as Row[];
  return rows.map((row) => toRecord(db, row));
}

// One transaction: the message and the advance of next_run_at stand or fall together, so a crash cannot repeat or lose a run.
// The next_run_at guard makes a second call from a stale copy a no-op.
export function fireRecurring(
  db: Db, rule: Recurring, run: { sendAt: number | null; nextRunAt: number | null }, now = nowSeconds(),
): boolean {
  return db.transaction(() => {
    const advanced = db.prepare(
      `UPDATE recurring_messages SET next_run_at = ?, enabled = ?, last_run_at = COALESCE(?, last_run_at)
       WHERE id = ? AND enabled = 1 AND next_run_at = ?`,
    ).run(run.nextRunAt, run.nextRunAt === null ? 0 : 1, run.sendAt, rule.id, rule.nextRunAt).changes > 0;
    if (!advanced) return false;
    if (run.sendAt !== null) {
      createMessage(db, rule.text, rule.chats.map((c) => c.id), run.sendAt, now, { entities: rule.entities, recurringId: rule.id });
    }
    return true;
  })();
}
