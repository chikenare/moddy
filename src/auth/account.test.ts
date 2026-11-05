import { beforeEach, expect, test } from "vitest";
import { type Db, openDatabase } from "../db/connection.js";
import {
  PANEL_USERNAME, changeAccountPassword, createInitialAccount, credentialsMatch, describeNewPassword, getPanelAccount,
  hashPassword, passwordProblem, resetAccountPassword, saveAccount, verifyPassword,
} from "./account.js";
import { createSession, isValidSession } from "./session.js";

const FAST = { N: 2, r: 1, p: 1 };
const NOW = 1_000_000_000_000;
let db: Db;

beforeEach(() => {
  db = openDatabase(":memory:");
});

test("the real cost follows the OWASP recommendation for scrypt", () => {
  const stored = hashPassword("correct horse battery");
  expect(stored).toMatch(/^scrypt\$131072\$8\$1\$/);
  expect(verifyPassword(stored, "correct horse battery")).toBe(true);
});

test("a hash checks the right password only, and never contains it", () => {
  const stored = hashPassword("correct horse battery", FAST);
  expect(verifyPassword(stored, "correct horse battery")).toBe(true);
  expect(verifyPassword(stored, "correct horse batterz")).toBe(false);
  expect(verifyPassword(stored, "")).toBe(false);
  expect(stored).not.toContain("correct horse battery");
});

test("two hashes of the same password differ, because each has its own salt", () => {
  expect(hashPassword("correct horse battery", FAST)).not.toBe(hashPassword("correct horse battery", FAST));
});

const WHOLE_HASH = Buffer.alloc(32, 1).toString("base64url");

test.each([
  "", "nonsense", "scrypt$2$1$1$", "bcrypt$2$1$1$c2FsdA$aGFzaA", "scrypt$3$1$1$c2FsdA$aGFzaA", "scrypt$2$1$1$c2FsdA$aGFzaA",
  `bcrypt$2$1$1$c2FsdA$${WHOLE_HASH}`, `scrypt$3$1$1$c2FsdA$${WHOLE_HASH}`, `scrypt$x$1$1$c2FsdA$${WHOLE_HASH}`, `scrypt$2$1$1$$${WHOLE_HASH}`,
])("a stored value %j that cannot be checked refuses every password", (stored) => {
  expect(verifyPassword(stored, "correct horse battery")).toBe(false);
});

test("a real hash under another scheme refuses the right password", () => {
  const stored = hashPassword("correct horse battery", FAST);
  expect(verifyPassword(stored.replace("scrypt", "bcrypt"), "correct horse battery")).toBe(false);
});

test("changing any end of the hash refuses the right password", () => {
  const stored = hashPassword("correct horse battery", FAST);
  const parts = stored.split("$");
  const hash = Buffer.from(parts[5]!, "base64url");
  for (const index of [0, hash.length - 1]) {
    const changed = Buffer.from(hash);
    changed[index]! ^= 1;
    parts[5] = changed.toString("base64url");
    expect(verifyPassword(parts.join("$"), "correct horse battery")).toBe(false);
  }
});

test("the first start creates admin with a random password that must be changed", () => {
  const password = createInitialAccount(db, NOW, FAST)!;
  expect(password.length).toBeGreaterThanOrEqual(24);
  const account = getPanelAccount(db)!;
  expect(account.username).toBe(PANEL_USERNAME);
  expect(PANEL_USERNAME).toBe("admin");
  expect(account.mustChangePassword).toBe(true);
  expect(verifyPassword(account.passwordHash, password)).toBe(true);
  expect(JSON.stringify(db.prepare("SELECT * FROM panel_account").all())).not.toContain(password);
});

test("each install gets a different initial password", () => {
  const first = createInitialAccount(db, NOW, FAST);
  const second = createInitialAccount(openDatabase(":memory:"), NOW, FAST);
  expect(first).not.toBe(second);
});

test("the message for the logs names the username and the password", () => {
  const message = describeNewPassword("the-generated-one");
  expect(message).toContain("Panel login");
  expect(message).toContain("username admin");
  expect(message).toContain("password the-generated-one ");
});

test("later starts leave the account alone and show nothing", () => {
  const password = createInitialAccount(db, NOW, FAST)!;
  const before = getPanelAccount(db);
  expect(createInitialAccount(db, NOW + 1000, FAST)).toBeNull();
  expect(getPanelAccount(db)).toEqual(before);
  expect(verifyPassword(getPanelAccount(db)!.passwordHash, password)).toBe(true);
});

test("credentials need the right username and password, and an account", () => {
  expect(credentialsMatch(undefined, "admin", "correct horse battery")).toBe(false);
  saveAccount(db, { username: "admin", passwordHash: hashPassword("correct horse battery", FAST), mustChangePassword: false }, NOW);
  const account = getPanelAccount(db);
  expect(credentialsMatch(account, "admin", "correct horse battery")).toBe(true);
  expect(credentialsMatch(account, "root", "correct horse battery")).toBe(false);
  expect(credentialsMatch(account, "admin", "wrong password here")).toBe(false);
  expect(credentialsMatch(account, "", "")).toBe(false);
});

test.each([
  ["too short", "eleven char", /at least 12/],
  ["only spaces", " ".repeat(20), /at least 12/],
  ["short once trimmed", `  ${"a".repeat(5)}  ${" ".repeat(10)}`, /at least 12/],
  ["too long", "b".repeat(257), /at most 256/],
  ["the current one", "correct horse battery", /different/],
])("a new password that is %s is refused", (_name, password, message) => {
  expect(passwordProblem(password, "correct horse battery")).toMatch(message);
});

test.each(["aaaaaaaaaaaa", "aabbaabbaabb", "password1234", "Password-1234", "adminadmin12", "qwerty123456", "123456789012"])(
  "a new password %j is too common",
  (password) => {
    expect(passwordProblem(password, "correct horse battery")).toBe("Choose a less common password.");
  },
);

test.each(["twelve chars", "abcde".repeat(51) + "a", "a brand new password", "0123456789abcdef"])("a new password %j is accepted", (password) => {
  expect(passwordProblem(password, "correct horse battery")).toBeNull();
});

test("changing the password replaces it, clears the flag and ends every session", () => {
  createInitialAccount(db, NOW, FAST);
  const session = createSession(db, NOW);
  expect(changeAccountPassword(db, getPanelAccount(db)!.passwordHash, "a brand new password", NOW, FAST)).toBe(true);
  const account = getPanelAccount(db)!;
  expect(account.mustChangePassword).toBe(false);
  expect(account.username).toBe("admin");
  expect(verifyPassword(account.passwordHash, "a brand new password")).toBe(true);
  expect(isValidSession(db, session, NOW)).toBe(false);
});

test("a change based on a password that was replaced meanwhile changes nothing", () => {
  saveAccount(db, { username: "admin", passwordHash: hashPassword("correct horse battery", FAST), mustChangePassword: false }, NOW);
  const verified = getPanelAccount(db)!.passwordHash;
  const reset = resetAccountPassword(db, NOW, FAST);
  const session = createSession(db, NOW);
  expect(changeAccountPassword(db, verified, "a brand new password", NOW, FAST)).toBe(false);
  const account = getPanelAccount(db)!;
  expect(verifyPassword(account.passwordHash, reset)).toBe(true);
  expect(account.mustChangePassword).toBe(true);
  expect(isValidSession(db, session, NOW)).toBe(true);
});

test("resetting gives a new random password that must be changed, and ends every session", () => {
  saveAccount(db, { username: "admin", passwordHash: hashPassword("correct horse battery", FAST), mustChangePassword: false }, NOW);
  const session = createSession(db, NOW);
  const password = resetAccountPassword(db, NOW, FAST);
  const account = getPanelAccount(db)!;
  expect(account.mustChangePassword).toBe(true);
  expect(verifyPassword(account.passwordHash, password)).toBe(true);
  expect(verifyPassword(account.passwordHash, "correct horse battery")).toBe(false);
  expect(isValidSession(db, session, NOW)).toBe(false);
});

test("resetting also works if the account does not exist yet", () => {
  const password = resetAccountPassword(db, NOW, FAST);
  expect(verifyPassword(getPanelAccount(db)!.passwordHash, password)).toBe(true);
});
