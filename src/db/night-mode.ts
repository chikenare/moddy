import type { ChatPermissions } from "grammy/types";
import type { FormattedEntity } from "./auto-replies.js";
import type { Db } from "./connection.js";

export type NightState = "open" | "closed";
export interface NightNotice { enabled: boolean; text: string; entities: FormattedEntity[] }
export interface NightModeSettings {
  enabled: boolean;
  closeTime: string; // HH:MM, in `timezone`
  openTime: string;
  timezone: string;
  days: number[]; // nights that close, by the day they start; 0 = Sunday
  closeNotice: NightNotice;
  openNotice: NightNotice;
  deleteCloseNotice: boolean;
}
export interface NightMode extends NightModeSettings {
  chatId: number;
  configured: boolean;
  state: NightState;
  // A manual close or open holds until the schedule itself changes from `overrideSchedule`.
  override: NightState | null;
  overrideSchedule: NightState | null;
  savedPermissions: ChatPermissions | null;
  closeMessageId: number | null;
  error: string | null;
  retryAt: number | null;
}

interface Row {
  chat_id: number; enabled: number; close_time: string; open_time: string; timezone: string; days: string;
  close_notice_enabled: number; close_text: string; close_entities: string;
  open_notice_enabled: number; open_text: string; open_entities: string;
  delete_close_notice: number; state: string; override: string | null; override_schedule: string | null;
  saved_permissions: string | null; close_message_id: number | null; error: string | null; retry_at: number | null;
}

const DEFAULTS: Omit<Row, "chat_id"> = {
  enabled: 0, close_time: "23:00", open_time: "07:00", timezone: "UTC", days: "[0,1,2,3,4,5,6]",
  close_notice_enabled: 1, close_text: "", close_entities: "[]",
  open_notice_enabled: 1, open_text: "", open_entities: "[]",
  delete_close_notice: 1, state: "open", override: null, override_schedule: null,
  saved_permissions: null, close_message_id: null, error: null, retry_at: null,
};

const nowSeconds = () => Math.floor(Date.now() / 1000);

function toRecord(row: Row, configured: boolean): NightMode {
  return {
    chatId: row.chat_id, configured,
    enabled: row.enabled === 1, closeTime: row.close_time, openTime: row.open_time, timezone: row.timezone,
    days: JSON.parse(row.days) as number[],
    closeNotice: { enabled: row.close_notice_enabled === 1, text: row.close_text, entities: JSON.parse(row.close_entities) as FormattedEntity[] },
    openNotice: { enabled: row.open_notice_enabled === 1, text: row.open_text, entities: JSON.parse(row.open_entities) as FormattedEntity[] },
    deleteCloseNotice: row.delete_close_notice === 1,
    state: row.state as NightState,
    override: row.override as NightState | null,
    overrideSchedule: row.override_schedule as NightState | null,
    savedPermissions: row.saved_permissions === null ? null : (JSON.parse(row.saved_permissions) as ChatPermissions),
    closeMessageId: row.close_message_id, error: row.error, retryAt: row.retry_at,
  };
}

/** A chat that never set it up gets the defaults, without a row. */
export function getNightMode(db: Db, chatId: number): NightMode {
  const row = db.prepare("SELECT * FROM chat_night_mode WHERE chat_id = ?").get(chatId) as Row | undefined;
  return row ? toRecord(row, true) : toRecord({ ...DEFAULTS, chat_id: chatId }, false);
}

function ensure(db: Db, chatId: number, now: number): void {
  db.prepare("INSERT OR IGNORE INTO chat_night_mode (chat_id, updated_at) VALUES (?, ?)").run(chatId, now);
}

function set(db: Db, chatId: number, values: Partial<Omit<Row, "chat_id">>, now = nowSeconds()): void {
  ensure(db, chatId, now);
  const keys = Object.keys(values) as (keyof typeof values)[];
  db.prepare(`UPDATE chat_night_mode SET ${[...keys.map((k) => `${k} = ?`), "updated_at = ?"].join(", ")} WHERE chat_id = ?`)
    .run(...keys.map((k) => values[k] ?? null), now, chatId);
}

// Saving clears a pending retry, so a fixed setting (or a fixed bot permission) is tried right away.
export function saveNightModeSettings(db: Db, chatId: number, s: NightModeSettings, now = nowSeconds()): NightMode {
  set(db, chatId, {
    enabled: s.enabled ? 1 : 0, close_time: s.closeTime, open_time: s.openTime, timezone: s.timezone,
    days: JSON.stringify([...new Set(s.days)].sort((a, b) => a - b)),
    close_notice_enabled: s.closeNotice.enabled ? 1 : 0, close_text: s.closeNotice.text, close_entities: JSON.stringify(s.closeNotice.entities),
    open_notice_enabled: s.openNotice.enabled ? 1 : 0, open_text: s.openNotice.text, open_entities: JSON.stringify(s.openNotice.entities),
    delete_close_notice: s.deleteCloseNotice ? 1 : 0, retry_at: null,
  }, now);
  return getNightMode(db, chatId);
}

export function setNightOverride(db: Db, chatId: number, override: NightState, scheduled: NightState, now = nowSeconds()): void {
  set(db, chatId, { override, override_schedule: scheduled, retry_at: null }, now);
}

export function clearNightOverride(db: Db, chatId: number): void {
  set(db, chatId, { override: null, override_schedule: null });
}

/** Chats the worker must look at: on a schedule, held by hand, or still closed after being switched off. */
export function listNightModesToCheck(db: Db): NightMode[] {
  const rows = db.prepare(
    `SELECT n.* FROM chat_night_mode n JOIN chats c ON c.id = n.chat_id
     WHERE c.type != 'channel' AND c.bot_status NOT IN ('left', 'kicked')
       AND (n.enabled = 1 OR n.override IS NOT NULL OR n.state = 'closed')`,
  ).all() as Row[];
  return rows.map((row) => toRecord(row, true));
}

// Kept before closing, so a crash between the two steps never loses the group's own permissions.
export function saveNightPermissions(db: Db, chatId: number, permissions: ChatPermissions): void {
  set(db, chatId, { saved_permissions: JSON.stringify(permissions) });
}

export function markNightClosed(db: Db, chatId: number, closeMessageId: number | null): void {
  set(db, chatId, { state: "closed", close_message_id: closeMessageId, error: null, retry_at: null });
}

export function markNightOpen(db: Db, chatId: number): void {
  set(db, chatId, { state: "open", saved_permissions: null, close_message_id: null, error: null, retry_at: null });
}

export function recordNightError(db: Db, chatId: number, error: string, retryAt: number): void {
  set(db, chatId, { error, retry_at: retryAt });
}
