import type { Db } from "./connection.js";

function list(db: Db, table: string, column: string, chatId: number): string[] {
  return db.prepare(`SELECT ${column} FROM ${table} WHERE chat_id = ? ORDER BY ${column}`).pluck().all(chatId) as string[];
}

function add(db: Db, table: string, column: string, chatId: number, value: string): void {
  db.prepare(`INSERT OR IGNORE INTO ${table} (chat_id, ${column}) VALUES (?, ?)`).run(chatId, value);
}

function remove(db: Db, table: string, column: string, chatId: number, value: string): boolean {
  return db.prepare(`DELETE FROM ${table} WHERE chat_id = ? AND ${column} = ?`).run(chatId, value).changes > 0;
}

export const listWords = (db: Db, chatId: number): string[] => list(db, "chat_words", "word", chatId);
export const addWord = (db: Db, chatId: number, word: string): void => add(db, "chat_words", "word", chatId, word);
export const removeWord = (db: Db, chatId: number, word: string): boolean => remove(db, "chat_words", "word", chatId, word);

export const listWhitelist = (db: Db, chatId: number): string[] => list(db, "chat_whitelist", "entry", chatId);
export const addWhitelistEntry = (db: Db, chatId: number, entry: string): void => add(db, "chat_whitelist", "entry", chatId, entry);
export const removeWhitelistEntry = (db: Db, chatId: number, entry: string): boolean => remove(db, "chat_whitelist", "entry", chatId, entry);
