import { beforeEach, expect, test } from "vitest";
import { type Db, openDatabase } from "../db/connection.js";
import { SESSION_SECONDS, createSession, deleteAllSessions, deleteSession, isValidSession, purgeSessions } from "./session.js";

const START_MS = 1_000_000_000_000;
const START = START_MS / 1000;
let db: Db;

beforeEach(() => {
  db = openDatabase(":memory:");
});

test("each session gets its own long random token", () => {
  const first = createSession(db, START_MS);
  const second = createSession(db, START_MS);
  expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(second).not.toBe(first);
});

test("a session is valid until it expires, and only with its token", () => {
  const token = createSession(db, START_MS);
  expect(isValidSession(db, token, START_MS)).toBe(true);
  expect(isValidSession(db, token, (START + SESSION_SECONDS - 1) * 1000)).toBe(true);
  expect(isValidSession(db, token, (START + SESSION_SECONDS) * 1000)).toBe(false);
  expect(isValidSession(db, `${token}x`, START_MS)).toBe(false);
  expect(isValidSession(db, undefined, START_MS)).toBe(false);
});

test("deleting a session ends only that one", () => {
  const first = createSession(db, START_MS);
  const second = createSession(db, START_MS);
  deleteSession(db, first);
  expect(isValidSession(db, first, START_MS)).toBe(false);
  expect(isValidSession(db, second, START_MS)).toBe(true);
});

test("deleting all sessions ends every one", () => {
  const first = createSession(db, START_MS);
  const second = createSession(db, START_MS);
  deleteAllSessions(db);
  expect(isValidSession(db, first, START_MS)).toBe(false);
  expect(isValidSession(db, second, START_MS)).toBe(false);
});

test("purge removes sessions once they expire and keeps the live ones", () => {
  const old = createSession(db, START_MS);
  const recent = createSession(db, START_MS + 86_400_000);
  expect(purgeSessions(db, START + SESSION_SECONDS - 1)).toBe(0);
  expect(purgeSessions(db, START + SESSION_SECONDS)).toBe(1);
  const at = (START + SESSION_SECONDS) * 1000;
  expect(isValidSession(db, old, at)).toBe(false);
  expect(isValidSession(db, recent, at)).toBe(true);
  expect(db.prepare("SELECT count(*) FROM panel_sessions").pluck().get()).toBe(1);
});
