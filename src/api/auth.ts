import { type Context, Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { LoginLimiter } from "../auth/limiter.js";
import {
  type Credentials, SESSION_SECONDS, createSession, credentialsMatch, deleteSession, isValidSession, sessionKey,
} from "../auth/session.js";
import type { Db } from "../db/connection.js";

// Cookies ignore ports, so a generic name could clash with another app on localhost.
const COOKIE = "panel_session";
const PUBLIC_ROUTES = new Set(["GET /api/health", "GET /api/auth/session", "POST /api/auth/login", "POST /api/auth/logout"]);
const MAX_LOGIN_BYTES = 4096;
const loginBody = z.object({ username: z.string(), password: z.string() });

export function createAuth(deps: { db: Db; credentials: Credentials; now: () => number }) {
  const { db, credentials, now } = deps;
  if (!credentials.user || !credentials.password) throw new Error("The panel needs a username and a password");
  const key = sessionKey(credentials);
  const limiter = new LoginLimiter(now);
  const authenticated = (c: Context) => isValidSession(db, key, getCookie(c, COOKIE), now());

  const routes = new Hono();

  routes.post(
    "/login",
    bodyLimit({ maxSize: MAX_LOGIN_BYTES, onError: (c) => c.json({ error: "Invalid request" }, 400) }),
    async (c) => {
      const body = loginBody.safeParse(await c.req.json().catch(() => null));

      // Nothing may wait from here on: a guess whose body arrived late must still see every earlier failure.
      const retryAfter = limiter.retryAfterSeconds();
      if (retryAfter > 0) {
        const minutes = Math.ceil(retryAfter / 60);
        c.header("Retry-After", String(retryAfter));
        return c.json({ error: `Too many attempts. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.` }, 429);
      }
      if (!body.success) return c.json({ error: "Invalid request" }, 400);
      if (!credentialsMatch(credentials, body.data.username, body.data.password)) {
        if (limiter.recordFailure()) console.warn("Panel login is locked after too many failed attempts. Restarting the bot clears the lock.");
        return c.json({ error: "Wrong username or password" }, 401);
      }
      limiter.reset();
      setCookie(c, COOKIE, createSession(db, key, now()), {
        httpOnly: true,
        sameSite: "Strict",
        path: "/",
        maxAge: SESSION_SECONDS,
        secure: c.req.header("x-forwarded-proto") === "https",
      });
      return c.json({ authenticated: true });
    },
  );

  routes.post("/logout", (c) => {
    const token = getCookie(c, COOKIE);
    if (token) deleteSession(db, key, token);
    deleteCookie(c, COOKIE, { path: "/" });
    return c.body(null, 204);
  });

  routes.get("/session", (c) => c.json({ authenticated: authenticated(c) }));

  // Deny by default: a route added later is protected unless it is listed above.
  const requireSession: MiddlewareHandler = async (c, next) => {
    if (!PUBLIC_ROUTES.has(`${c.req.method} ${c.req.path}`) && !authenticated(c)) {
      return c.json({ error: "Not logged in" }, 401);
    }
    await next();
  };

  return { routes, requireSession };
}
