import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../db/connection.js";

export const SESSION_SECONDS = 30 * 24 * 60 * 60;

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const toSeconds = (ms: number) => Math.floor(ms / 1000);

export function createSession(db: Db, nowMs: number): string {
  const token = randomBytes(32).toString("base64url");
  const now = toSeconds(nowMs);
  db.prepare("INSERT INTO panel_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)")
    .run(tokenHash(token), now, now + SESSION_SECONDS);
  return token;
}

export function isValidSession(db: Db, token: string | undefined, nowMs: number): boolean {
  if (!token) return false;
  const expiresAt = db.prepare("SELECT expires_at FROM panel_sessions WHERE token_hash = ?").pluck().get(tokenHash(token)) as number | undefined;
  return expiresAt !== undefined && toSeconds(nowMs) < expiresAt;
}

export function deleteSession(db: Db, token: string): void {
  db.prepare("DELETE FROM panel_sessions WHERE token_hash = ?").run(tokenHash(token));
}

export function deleteAllSessions(db: Db): void {
  db.prepare("DELETE FROM panel_sessions").run();
}

export function purgeSessions(db: Db, nowSeconds: number): number {
  return db.prepare("DELETE FROM panel_sessions WHERE expires_at <= ?").run(nowSeconds).changes;
}
