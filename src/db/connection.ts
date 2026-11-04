import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export type Db = Database.Database;

export const MIGRATIONS: string[] = [
  `
  CREATE TABLE chats (
    id INTEGER PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, username TEXT,
    bot_status TEXT NOT NULL DEFAULT 'unknown',
    can_delete INTEGER NOT NULL DEFAULT 0, can_restrict INTEGER NOT NULL DEFAULT 0,
    linked_chat_id INTEGER,
    moderation_enabled INTEGER NOT NULL DEFAULT 0,
    link_filter_enabled INTEGER NOT NULL DEFAULT 1, link_filter_action TEXT NOT NULL DEFAULT 'delete_ban',
    word_filter_enabled INTEGER NOT NULL DEFAULT 1, word_filter_action TEXT NOT NULL DEFAULT 'delete_ban',
    flood_filter_enabled INTEGER NOT NULL DEFAULT 1, flood_filter_action TEXT NOT NULL DEFAULT 'delete_ban',
    flood_count INTEGER NOT NULL DEFAULT 5, flood_seconds INTEGER NOT NULL DEFAULT 10,
    bot_filter_enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE chat_words (
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON UPDATE CASCADE ON DELETE CASCADE,
    word TEXT NOT NULL, PRIMARY KEY (chat_id, word)
  ) STRICT;
  CREATE TABLE chat_whitelist (
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON UPDATE CASCADE ON DELETE CASCADE,
    entry TEXT NOT NULL, PRIMARY KEY (chat_id, entry)
  ) STRICT;
  CREATE TABLE moderation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON UPDATE CASCADE ON DELETE CASCADE,
    sender_type TEXT NOT NULL, sender_id INTEGER NOT NULL, sender_name TEXT NOT NULL,
    filter TEXT NOT NULL, matched TEXT NOT NULL, text TEXT, action TEXT NOT NULL,
    delete_ok INTEGER, ban_ok INTEGER, error TEXT,
    dry_run INTEGER NOT NULL, unbanned_at INTEGER, created_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX moderation_events_chat ON moderation_events(chat_id, id DESC);
  `,
  `
  ALTER TABLE chats ADD COLUMN notice_enabled INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE chats ADD COLUMN notice_template TEXT NOT NULL DEFAULT 'User {user} {action}: {reason}.';
  `,
  `
  ALTER TABLE chats ADD COLUMN rules TEXT NOT NULL DEFAULT '';
  ALTER TABLE chats ADD COLUMN auto_replies_enabled INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE chat_staff (
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON UPDATE CASCADE ON DELETE CASCADE,
    user_id INTEGER NOT NULL, display_name TEXT NOT NULL, added_at INTEGER NOT NULL,
    PRIMARY KEY (chat_id, user_id)
  ) STRICT;
  CREATE TABLE chat_seen_users (
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON UPDATE CASCADE ON DELETE CASCADE,
    user_id INTEGER NOT NULL, username TEXT, display_name TEXT NOT NULL, seen_at INTEGER NOT NULL,
    PRIMARY KEY (chat_id, user_id)
  ) STRICT;
  CREATE INDEX chat_seen_users_username ON chat_seen_users(chat_id, username);
  CREATE TABLE chat_auto_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON UPDATE CASCADE ON DELETE CASCADE,
    triggers TEXT NOT NULL, reply TEXT NOT NULL, created_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE scheduled_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL, send_at INTEGER NOT NULL, created_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE scheduled_message_targets (
    message_id INTEGER NOT NULL REFERENCES scheduled_messages(id) ON DELETE CASCADE,
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON UPDATE CASCADE ON DELETE CASCADE,
    status TEXT NOT NULL, error TEXT, sent_at INTEGER,
    PRIMARY KEY (message_id, chat_id)
  ) STRICT;
  CREATE INDEX scheduled_message_targets_status ON scheduled_message_targets(status);
  `,
  `
  ALTER TABLE chat_auto_replies ADD COLUMN entities TEXT NOT NULL DEFAULT '[]';
  `,
];

export function openDatabase(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const apply = db.transaction(() => {
    const current = db.pragma("user_version", { simple: true }) as number;
    for (let v = current; v < MIGRATIONS.length; v++) {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    }
  });
  apply();
}
