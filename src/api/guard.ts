import type { MiddlewareHandler } from "hono";

const ALLOWED_HOSTS = new Set(["bot.localhost", "panel.localhost", "localhost", "127.0.0.1", "[::1]"]);

function hostname(host: string): string {
  const end = host.indexOf("]");
  if (end !== -1) return host.slice(0, end + 1).toLowerCase();
  return host.split(":")[0]!.toLowerCase();
}

export const hostOriginGuard: MiddlewareHandler = async (c, next) => {
  const host = c.req.header("host");
  if (!host || !ALLOWED_HOSTS.has(hostname(host))) {
    return c.json({ error: "Host not allowed" }, 403);
  }
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD") {
    const origin = c.req.header("origin");
    if (origin !== undefined) {
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host.toLowerCase();
      } catch { /* invalid origin */ }
      if (originHost !== host.toLowerCase()) return c.json({ error: "Origin not allowed" }, 403);
    }
  }
  await next();
};
