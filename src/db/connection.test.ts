import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, test } from "vitest";
import { getChat } from "./chats.js";
import { MIGRATIONS, openDatabase } from "./connection.js";

test("activa claves foráneas y crea las tablas", () => {
  const db = openDatabase(":memory:");
  expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").pluck().all();
  expect(names).toEqual(expect.arrayContaining(["chats", "chat_words", "chat_whitelist", "moderation_events"]));
});

test("en archivo usa WAL, crea la carpeta y reabrir no repite migraciones", () => {
  const path = join(mkdtempSync(join(tmpdir(), "db-")), "sub", "a.sqlite");
  openDatabase(path).close();
  const db = openDatabase(path);
  expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
  expect(db.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);
});

test("una base en la versión 1 sube a la 2 sin perder chats y con el aviso apagado", () => {
  const path = join(mkdtempSync(join(tmpdir(), "db-")), "a.sqlite");
  const old = new Database(path);
  old.exec(MIGRATIONS[0]!);
  old.pragma("user_version = 1");
  old.prepare("INSERT INTO chats (id, type, title, moderation_enabled, created_at, updated_at) VALUES (-1, 'supergroup', 'Grupo', 1, 1, 1)").run();
  old.close();
  const chat = getChat(openDatabase(path), -1);
  expect(chat).toMatchObject({
    title: "Grupo", moderationEnabled: true, noticeEnabled: false,
    noticeTemplate: "User {user} {action}: {reason}.",
  });
});
