import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { openDatabase } from "./connection.js";

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
  expect(db.pragma("user_version", { simple: true })).toBe(1);
});
