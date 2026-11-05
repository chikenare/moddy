import { beforeEach, expect, test, vi } from "vitest";
import { type Db, openDatabase } from "../db/connection.js";
import { type ApiTelegram, createApi } from "./app.js";

const race = vi.hoisted(() => ({ during: null as (() => void) | null }));

// The reset script is another process, so its write can land while this one hashes the new password.
vi.mock("../auth/account.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/account.js")>();
  return {
    ...actual,
    verifyPassword: (stored: string, password: string) => {
      const ok = actual.verifyPassword(stored, password);
      race.during?.();
      race.during = null;
      return ok;
    },
  };
});

const { getPanelAccount, hashPassword, resetAccountPassword, saveAccount, verifyPassword } = await import("../auth/account.js");

const FAST = { N: 2, r: 1, p: 1 };
const PASSWORD = "correct horse battery";
let db: Db;
let app: ReturnType<typeof createApi>;

beforeEach(() => {
  db = openDatabase(":memory:");
  saveAccount(db, { username: "admin", passwordHash: hashPassword(PASSWORD, FAST), mustChangePassword: false }, Date.now());
  app = createApi({
    db, telegram: {} as ApiTelegram, appEnv: "production", botUsername: () => null, onMessageQueued: vi.fn(), fetchPhoto: vi.fn(async () => null),
  });
});

const post = (path: string, body: unknown, cookie = "") => app.request(`http://ignored${path}`, {
  method: "POST",
  headers: { Host: "bot.localhost", "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify(body),
});

test("a reset that lands during a password change wins, and the change gets no session", async () => {
  const session = (await post("/api/auth/login", { username: "admin", password: PASSWORD })).headers.get("Set-Cookie")!.split(";")[0]!;
  let reset = "";
  race.during = () => { reset = resetAccountPassword(db, Date.now(), FAST); };

  const r = await post("/api/auth/password", { currentPassword: PASSWORD, newPassword: "the attacker's new password" }, session);

  expect(r.status).toBe(409);
  expect(await r.json()).toEqual({ error: "The password was changed by something else. Log in again." });
  expect(r.headers.get("Set-Cookie")).toBeNull();
  const account = getPanelAccount(db)!;
  expect(verifyPassword(account.passwordHash, reset)).toBe(true);
  expect(account.mustChangePassword).toBe(true);
});
