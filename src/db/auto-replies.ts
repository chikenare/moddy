import type { Db } from "./connection.js";

export interface FormattedEntity {
  type: "bold" | "italic" | "underline" | "strikethrough" | "spoiler" | "code" | "blockquote" | "text_link";
  offset: number;
  length: number;
  url?: string;
}

export interface AutoReply {
  id: number; chatId: number; triggers: string[]; reply: string; entities: FormattedEntity[]; createdAt: number;
}

interface Row { id: number; chat_id: number; triggers: string; reply: string; entities: string; created_at: number }

const toRecord = (row: Row): AutoReply => ({
  id: row.id, chatId: row.chat_id, triggers: JSON.parse(row.triggers) as string[], reply: row.reply,
  entities: JSON.parse(row.entities) as FormattedEntity[], createdAt: row.created_at,
});

export function listAutoReplies(db: Db, chatId: number): AutoReply[] {
  return (db.prepare("SELECT * FROM chat_auto_replies WHERE chat_id = ? ORDER BY id").all(chatId) as Row[]).map(toRecord);
}

export function getAutoReply(db: Db, chatId: number, id: number): AutoReply | undefined {
  const row = db.prepare("SELECT * FROM chat_auto_replies WHERE chat_id = ? AND id = ?").get(chatId, id) as Row | undefined;
  return row && toRecord(row);
}

export function insertAutoReply(db: Db, chatId: number, triggers: string[], reply: string, entities: FormattedEntity[] = []): AutoReply {
  const { lastInsertRowid } = db.prepare(
    "INSERT INTO chat_auto_replies (chat_id, triggers, reply, entities, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(chatId, JSON.stringify(triggers), reply, JSON.stringify(entities), Math.floor(Date.now() / 1000));
  return getAutoReply(db, chatId, Number(lastInsertRowid))!;
}

export function updateAutoReply(
  db: Db, chatId: number, id: number, triggers: string[], reply: string, entities: FormattedEntity[] = [],
): AutoReply | undefined {
  db.prepare("UPDATE chat_auto_replies SET triggers = ?, reply = ?, entities = ? WHERE chat_id = ? AND id = ?")
    .run(JSON.stringify(triggers), reply, JSON.stringify(entities), chatId, id);
  return getAutoReply(db, chatId, id);
}

export function deleteAutoReply(db: Db, chatId: number, id: number): boolean {
  return db.prepare("DELETE FROM chat_auto_replies WHERE chat_id = ? AND id = ?").run(chatId, id).changes > 0;
}
