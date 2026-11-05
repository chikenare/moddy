import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Db } from "../db/connection.js";

export interface Credentials { user: string; password: string }

export const SESSION_SECONDS = 30 * 24 * 60 * 60;

const sha256 = (value: string) => createHash("sha256").update(value).digest();
const toSeconds = (ms: number) => Math.floor(ms / 1000);

export function credentialsMatch(expected: Credentials, user: string, password: string): boolean {
  const userOk = timingSafeEqual(sha256(user), sha256(expected.user));
  const passwordOk = timingSafeEqual(sha256(password), sha256(expected.password));
  return userOk && passwordOk;
}

const keys = new Map<string, Buffer>();

// Session rows are hashed with a key made from the credentials, so changing them ends every session and a copy of the
// database holds nothing to test a password against. Slow on purpose: a stolen cookie plus its row would allow guessing.
export function sessionKey(credentials: Credentials): Buffer {
  const material = `${credentials.user}\0${credentials.password}`;
  let key = keys.get(material);
  if (!key) {
    key = scryptSync(material, "panel-session", 32);
    keys.set(material, key);
  }
  return key;
}

const tokenHash = (key: Buffer, token: string) => createHmac("sha256", key).update(token).digest("hex");

export function createSession(db: Db, key: Buffer, nowMs: number): string {
  const token = randomBytes(32).toString("base64url");
  const now = toSeconds(nowMs);
  db.prepare("INSERT INTO panel_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)")
    .run(tokenHash(key, token), now, now + SESSION_SECONDS);
  return token;
}

export function isValidSession(db: Db, key: Buffer, token: string | undefined, nowMs: number): boolean {
  if (!token) return false;
  const expiresAt = db.prepare("SELECT expires_at FROM panel_sessions WHERE token_hash = ?").pluck().get(tokenHash(key, token)) as number | undefined;
  return expiresAt !== undefined && toSeconds(nowMs) < expiresAt;
}

export function deleteSession(db: Db, key: Buffer, token: string): void {
  db.prepare("DELETE FROM panel_sessions WHERE token_hash = ?").run(tokenHash(key, token));
}

export function purgeSessions(db: Db, nowSeconds: number): number {
  return db.prepare("DELETE FROM panel_sessions WHERE expires_at <= ?").run(nowSeconds).changes;
}
