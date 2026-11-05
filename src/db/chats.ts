import type { FormattedEntity } from "./auto-replies.js";
import type { Db } from "./connection.js";

export type ChatType = "group" | "supergroup" | "channel";
export type FilterAction = "delete" | "delete_ban";
export interface ChatRecord {
  id: number; type: ChatType; title: string; username: string | null;
  botStatus: string; canDelete: boolean; canRestrict: boolean; linkedChatId: number | null;
  moderationEnabled: boolean;
  linkFilterEnabled: boolean; linkFilterAction: FilterAction;
  wordFilterEnabled: boolean; wordFilterAction: FilterAction;
  floodFilterEnabled: boolean; floodFilterAction: FilterAction;
  floodCount: number; floodSeconds: number;
  botFilterEnabled: boolean;
  noticeEnabled: boolean; noticeTemplate: string;
  rules: string; rulesEntities: FormattedEntity[]; autoRepliesEnabled: boolean;
  commandsEnabled: boolean; warnLimit: number;
  createdAt: number; updatedAt: number;
}
export type ChatSettings = Pick<ChatRecord, "moderationEnabled" | "linkFilterEnabled" | "linkFilterAction" | "wordFilterEnabled" | "wordFilterAction" | "floodFilterEnabled" | "floodFilterAction" | "floodCount" | "floodSeconds" | "botFilterEnabled" | "noticeEnabled" | "noticeTemplate" | "rules" | "rulesEntities" | "autoRepliesEnabled" | "commandsEnabled" | "warnLimit">;
export type ChatInfo = Partial<Pick<ChatRecord, "title" | "username" | "botStatus" | "canDelete" | "canRestrict" | "linkedChatId" | "type">>;

type Row = Record<string, number | string | null>;

const COLUMNS: Record<keyof ChatRecord, string> = {
  id: "id", type: "type", title: "title", username: "username",
  botStatus: "bot_status", canDelete: "can_delete", canRestrict: "can_restrict", linkedChatId: "linked_chat_id",
  moderationEnabled: "moderation_enabled",
  linkFilterEnabled: "link_filter_enabled", linkFilterAction: "link_filter_action",
  wordFilterEnabled: "word_filter_enabled", wordFilterAction: "word_filter_action",
  floodFilterEnabled: "flood_filter_enabled", floodFilterAction: "flood_filter_action",
  floodCount: "flood_count", floodSeconds: "flood_seconds",
  botFilterEnabled: "bot_filter_enabled",
  noticeEnabled: "notice_enabled", noticeTemplate: "notice_template",
  rules: "rules", rulesEntities: "rules_entities", autoRepliesEnabled: "auto_replies_enabled",
  commandsEnabled: "commands_enabled", warnLimit: "warn_limit",
  createdAt: "created_at", updatedAt: "updated_at",
};

const BOOLEANS = new Set<string>(["canDelete", "canRestrict", "moderationEnabled", "linkFilterEnabled", "wordFilterEnabled", "floodFilterEnabled", "botFilterEnabled", "noticeEnabled", "autoRepliesEnabled", "commandsEnabled"]);

function toRecord(row: Row): ChatRecord {
  const out: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(COLUMNS)) {
    out[key] = BOOLEANS.has(key) ? row[col] === 1 : key === "rulesEntities" ? JSON.parse(row[col] as string) : row[col];
  }
  return out as unknown as ChatRecord;
}

function toDbValue(value: unknown): unknown {
  if (Array.isArray(value)) return JSON.stringify(value);
  return typeof value === "boolean" ? (value ? 1 : 0) : value;
}

export function getChat(db: Db, id: number): ChatRecord | undefined {
  const row = db.prepare("SELECT * FROM chats WHERE id = ?").get(id) as Row | undefined;
  return row && toRecord(row);
}

export function listChats(db: Db): ChatRecord[] {
  return (db.prepare("SELECT * FROM chats ORDER BY title, id").all() as Row[]).map(toRecord);
}

export function insertChat(
  db: Db,
  input: { id: number; type: ChatType; title: string; username: string | null },
  seedWords: string[],
): ChatRecord {
  const now = Math.floor(Date.now() / 1000);
  db.transaction(() => {
    db.prepare("INSERT INTO chats (id, type, title, username, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(input.id, input.type, input.title, input.username, now, now);
    const seed = db.prepare("INSERT OR IGNORE INTO chat_words (chat_id, word) VALUES (?, ?)");
    for (const word of seedWords) seed.run(input.id, word);
  })();
  return getChat(db, input.id)!;
}

function update(db: Db, id: number, values: Record<string, unknown>): void {
  const keys = Object.keys(values).filter((k) => values[k] !== undefined);
  const sets = keys.map((k) => `${COLUMNS[k as keyof ChatRecord]} = ?`);
  sets.push("updated_at = ?");
  db.prepare(`UPDATE chats SET ${sets.join(", ")} WHERE id = ?`)
    .run(...keys.map((k) => toDbValue(values[k])), Math.floor(Date.now() / 1000), id);
}

export function updateChatInfo(db: Db, id: number, info: ChatInfo): void {
  update(db, id, info);
}

export function updateChatSettings(db: Db, id: number, patch: Partial<ChatSettings>): ChatRecord | undefined {
  if (!getChat(db, id)) return undefined;
  update(db, id, patch);
  return getChat(db, id);
}

export function migrateChatId(db: Db, fromId: number, toId: number): void {
  db.transaction(() => {
    if (!getChat(db, fromId)) return;
    db.prepare("DELETE FROM chats WHERE id = ?").run(toId);
    db.prepare("UPDATE chats SET id = ? WHERE id = ?").run(toId, fromId);
  })();
}

export function deleteChat(db: Db, id: number): void {
  db.prepare("DELETE FROM chats WHERE id = ?").run(id);
}
