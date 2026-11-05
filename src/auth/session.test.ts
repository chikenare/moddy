import { beforeEach, expect, test } from "vitest";
import { type Db, openDatabase } from "../db/connection.js";
import { SESSION_SECONDS, createSession, deleteSession, isValidSession, purgeSessions, sessionKey } from "./session.js";

const KEY = sessionKey({ user: "owner", password: "correct horse battery" });
const START_MS = 1_000_000_000_000;
const START = START_MS / 1000;
let db: Db;

beforeEach(() => {
  db = openDatabase(":memory:");
});

test("the key depends on both the user and the password", () => {
  expect(sessionKey({ user: "owner", password: "correct horse battery" }).equals(KEY)).toBe(true);
  expect(sessionKey({ user: "other", password: "correct horse battery" }).equals(KEY)).toBe(false);
  expect(sessionKey({ user: "owner", password: "another password" }).equals(KEY)).toBe(false);
  expect(sessionKey({ user: "a\0b", password: "c" }).equals(sessionKey({ user: "a", password: "b\0c" }))).toBe(true);
});

test("each session gets its own long random token", () => {
  const first = createSession(db, KEY, START_MS);
  const second = createSession(db, KEY, START_MS);
  expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(second).not.toBe(first);
});

test("a token only works with the key that created it", () => {
  const token = createSession(db, KEY, START_MS);
  expect(isValidSession(db, KEY, token, START_MS)).toBe(true);
  expect(isValidSession(db, sessionKey({ user: "owner", password: "another password" }), token, START_MS)).toBe(false);
  expect(isValidSession(db, KEY, undefined, START_MS)).toBe(false);
});

test("deleting a session ends only that one", () => {
  const first = createSession(db, KEY, START_MS);
  const second = createSession(db, KEY, START_MS);
  deleteSession(db, KEY, first);
  expect(isValidSession(db, KEY, first, START_MS)).toBe(false);
  expect(isValidSession(db, KEY, second, START_MS)).toBe(true);
});

test("purge removes sessions once they expire and keeps the live ones", () => {
  const old = createSession(db, KEY, START_MS);
  const recent = createSession(db, KEY, START_MS + 86_400_000);
  expect(purgeSessions(db, START + SESSION_SECONDS - 1)).toBe(0);
  expect(purgeSessions(db, START + SESSION_SECONDS)).toBe(1);
  const at = (START + SESSION_SECONDS) * 1000;
  expect(isValidSession(db, KEY, old, at)).toBe(false);
  expect(isValidSession(db, KEY, recent, at)).toBe(true);
  expect(db.prepare("SELECT count(*) FROM panel_sessions").pluck().get()).toBe(1);
});
