import { type Context, Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { changeAccountPassword, credentialsMatch, getPanelAccount, passwordProblem, verifyPassword } from "../auth/account.js";
import { LoginLimiter } from "../auth/limiter.js";
import { SESSION_SECONDS, createSession, deleteSession, isValidSession } from "../auth/session.js";
import type { Db } from "../db/connection.js";

// Cookies ignore ports, so a generic name could clash with another app on localhost.
const COOKIE = "panel_session";
const PUBLIC_ROUTES = new Set(["GET /api/health", "GET /api/auth/session", "POST /api/auth/login", "POST /api/auth/logout"]);
const CHANGE_PASSWORD_ROUTE = "POST /api/auth/password";
const MAX_BODY_BYTES = 4096;
const loginBody = z.object({ username: z.string(), password: z.string() });
const changeBody = z.object({ currentPassword: z.string(), newPassword: z.string() });

export function createAuth(deps: { db: Db; now: () => number }) {
  const { db, now } = deps;
  const limiter = new LoginLimiter(now);
  const limitBody = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: "Invalid request" }, 400) });

  const authenticated = (c: Context) => getPanelAccount(db) !== undefined && isValidSession(db, getCookie(c, COOKIE), now());

  const refuseIfLocked = (c: Context) => {
    const retryAfter = limiter.retryAfterSeconds();
    if (retryAfter === 0) return null;
    const minutes = Math.ceil(retryAfter / 60);
    c.header("Retry-After", String(retryAfter));
    return c.json({ error: `Too many attempts. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.` }, 429);
  };
  const countFailure = () => {
    if (limiter.recordFailure()) console.warn("Panel login is locked after too many failed attempts. Restarting the bot clears the lock.");
  };
  const startSession = (c: Context) => setCookie(c, COOKIE, createSession(db, now()), {
    httpOnly: true,
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_SECONDS,
    secure: c.req.header("x-forwarded-proto") === "https",
  });

  const routes = new Hono();

  routes.post("/login", limitBody, async (c) => {
    const body = loginBody.safeParse(await c.req.json().catch(() => null));

    // Nothing may wait from here on: a guess whose body arrived late must still see every earlier failure.
    const locked = refuseIfLocked(c);
    if (locked) return locked;
    if (!body.success) return c.json({ error: "Invalid request" }, 400);
    const account = getPanelAccount(db);
    if (!credentialsMatch(account, body.data.username, body.data.password)) {
      countFailure();
      return c.json({ error: "Wrong username or password" }, 401);
    }
    limiter.reset();
    startSession(c);
    return c.json({ authenticated: true, mustChangePassword: account!.mustChangePassword });
  });

  routes.post("/password", limitBody, async (c) => {
    const body = changeBody.safeParse(await c.req.json().catch(() => null));

    // Nothing may wait from here on, as in the login: this also tests guesses at the password.
    const locked = refuseIfLocked(c);
    if (locked) return locked;
    if (!body.success) return c.json({ error: "Invalid request" }, 400);
    const account = getPanelAccount(db)!;
    if (!verifyPassword(account.passwordHash, body.data.currentPassword)) {
      countFailure();
      return c.json({ error: "The current password is wrong" }, 400);
    }
    limiter.reset();
    const problem = passwordProblem(body.data.newPassword, body.data.currentPassword);
    if (problem) return c.json({ error: problem }, 400);
    changeAccountPassword(db, body.data.newPassword, now());
    // Every session just ended, including this one, so this browser gets a new one.
    startSession(c);
    return c.json({ authenticated: true, mustChangePassword: false });
  });

  routes.post("/logout", (c) => {
    const token = getCookie(c, COOKIE);
    if (token) deleteSession(db, token);
    deleteCookie(c, COOKIE, { path: "/" });
    return c.body(null, 204);
  });

  routes.get("/session", (c) => {
    const loggedIn = authenticated(c);
    return c.json({ authenticated: loggedIn, mustChangePassword: loggedIn && getPanelAccount(db)!.mustChangePassword });
  });

  // Deny by default: a route added later is protected unless it is listed above.
  const requireSession: MiddlewareHandler = async (c, next) => {
    const route = `${c.req.method} ${c.req.path}`;
    if (PUBLIC_ROUTES.has(route)) return next();
    if (!authenticated(c)) return c.json({ error: "Not logged in" }, 401);
    if (route !== CHANGE_PASSWORD_ROUTE && getPanelAccount(db)!.mustChangePassword) {
      return c.json({ error: "Change the initial password first" }, 403);
    }
    await next();
  };

  return { routes, requireSession };
}
