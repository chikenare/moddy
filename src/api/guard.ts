import type { MiddlewareHandler } from "hono";

const LOCAL_HOSTS = ["bot.localhost", "panel.localhost", "localhost", "127.0.0.1", "[::1]"];

function hostname(host: string): string {
  const end = host.indexOf("]");
  if (end !== -1) return host.slice(0, end + 1).toLowerCase();
  return host.split(":")[0]!.toLowerCase();
}

export function hostOriginGuard(panelHost?: string | null): MiddlewareHandler {
  const allowedHosts = new Set(panelHost ? [...LOCAL_HOSTS, panelHost] : LOCAL_HOSTS);
  return async (c, next) => {
    const host = c.req.header("host");
    if (!host || !allowedHosts.has(hostname(host))) {
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
}
