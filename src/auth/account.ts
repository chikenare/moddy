import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Db } from "../db/connection.js";
import { deleteAllSessions } from "./session.js";

export const PANEL_USERNAME = "admin";

const MIN_PASSWORD = 12;
// Has to fit in a login request, which is limited to 4 KB.
const MAX_PASSWORD = 256;

export interface ScryptCost { N: number; r: number; p: number }

// OWASP's recommendation. Hashing blocks the bot for a moment, but the login limit allows only a few attempts.
const DEFAULT_COST: ScryptCost = { N: 2 ** 17, r: 8, p: 1 };
const KEY_BYTES = 32;

export interface PanelAccount {
  username: string;
  passwordHash: string;
  mustChangePassword: boolean;
}

const derive = (password: string, salt: Buffer, { N, r, p }: ScryptCost) =>
  scryptSync(password, salt, KEY_BYTES, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 });

export function hashPassword(password: string, cost: ScryptCost = DEFAULT_COST): string {
  const salt = randomBytes(16);
  return ["scrypt", cost.N, cost.r, cost.p, salt.toString("base64url"), derive(password, salt, cost).toString("base64url")].join("$");
}

export function verifyPassword(stored: string, password: string): boolean {
  const [scheme, N, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  if (expected.length !== KEY_BYTES) return false;
  try {
    const actual = derive(password, Buffer.from(salt, "base64url"), { N: Number(N), r: Number(r), p: Number(p) });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function getPanelAccount(db: Db): PanelAccount | undefined {
  const row = db.prepare("SELECT username, password_hash AS passwordHash, must_change_password AS mustChange FROM panel_account WHERE id = 1")
    .get() as { username: string; passwordHash: string; mustChange: number } | undefined;
  return row && { username: row.username, passwordHash: row.passwordHash, mustChangePassword: row.mustChange === 1 };
}

export function saveAccount(db: Db, account: PanelAccount, nowMs: number): void {
  db.prepare(`
    INSERT INTO panel_account (id, username, password_hash, must_change_password, updated_at) VALUES (1, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET username = excluded.username, password_hash = excluded.password_hash,
      must_change_password = excluded.must_change_password, updated_at = excluded.updated_at
  `).run(account.username, account.passwordHash, account.mustChangePassword ? 1 : 0, Math.floor(nowMs / 1000));
}

const sha256 = (value: string) => createHash("sha256").update(value).digest();

// Always hashes the password, so a wrong username takes as long as a wrong password.
export function credentialsMatch(account: PanelAccount | undefined, username: string, password: string): boolean {
  if (!account) return false;
  const usernameOk = timingSafeEqual(sha256(username), sha256(account.username));
  const passwordOk = verifyPassword(account.passwordHash, password);
  return usernameOk && passwordOk;
}

const generatePassword = () => randomBytes(18).toString("base64url");

function replaceWithGeneratedPassword(db: Db, nowMs: number, cost?: ScryptCost): string {
  const password = generatePassword();
  const passwordHash = hashPassword(password, cost);
  db.transaction(() => {
    saveAccount(db, { username: PANEL_USERNAME, passwordHash, mustChangePassword: true }, nowMs);
    deleteAllSessions(db);
  })();
  return password;
}

// Returns the password only when it creates the account: it cannot be recovered later.
export function createInitialAccount(db: Db, nowMs: number, cost?: ScryptCost): string | null {
  if (getPanelAccount(db)) return null;
  const password = generatePassword();
  const { changes } = db.prepare(`
    INSERT INTO panel_account (id, username, password_hash, must_change_password, updated_at) VALUES (1, ?, ?, 1, ?)
    ON CONFLICT (id) DO NOTHING
  `).run(PANEL_USERNAME, hashPassword(password, cost), Math.floor(nowMs / 1000));
  return changes === 1 ? password : null;
}

export function resetAccountPassword(db: Db, nowMs: number, cost?: ScryptCost): string {
  return replaceWithGeneratedPassword(db, nowMs, cost);
}

export function describeNewPassword(password: string): string {
  return `Panel login: username ${PANEL_USERNAME}, password ${password} . It is shown only this once, and the panel asks you to change it after you log in.`;
}

// The panel is public and its username is known, so these are the first guesses anyone would try.
const COMMON_WORDS = new Set([
  "password", "passwords", "passw", "contrasena", "clave", "admin", "adminadmin", "administrator", "qwerty", "qwertyuiop",
  "asdfgh", "letmein", "welcome", "iloveyou", "moddy", "telegram",
]);

function isCommon(password: string): boolean {
  const lower = password.toLowerCase();
  if (new Set(lower).size < 5 || /^\d+$/.test(lower)) return true;
  return COMMON_WORDS.has(lower.normalize("NFD").replace(/[^a-z]/g, ""));
}

export function passwordProblem(password: string, current: string): string | null {
  if (password.trim().length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (password.length > MAX_PASSWORD) return `Use at most ${MAX_PASSWORD} characters.`;
  if (password === current) return "Choose a different password.";
  if (isCommon(password)) return "Choose a less common password.";
  return null;
}

// Writes only if the password is still the one the caller verified: hashing takes a moment, and the reset script
// runs in another process. Otherwise someone with a session could undo a reset. Returns whether it changed.
export function changeAccountPassword(db: Db, verifiedHash: string, password: string, nowMs: number, cost?: ScryptCost): boolean {
  const passwordHash = hashPassword(password, cost);
  return db.transaction(() => {
    const { changes } = db.prepare("UPDATE panel_account SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = 1 AND password_hash = ?")
      .run(passwordHash, Math.floor(nowMs / 1000), verifiedHash);
    if (changes === 0) return false;
    deleteAllSessions(db);
    return true;
  })();
}
