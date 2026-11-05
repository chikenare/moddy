// Where to go after logging in. Only paths inside the panel, so a crafted link can't send the owner elsewhere.
export function safeNext(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next === "/login" || next.startsWith("/login?") ? "/" : next;
}

interface Destination {
  fullPath: string;
  meta: { public?: boolean };
  query: { next?: unknown; expired?: unknown };
}

// Where a navigation ends up, given whether there is a session.
export function guardRoute(to: Destination, authenticated: boolean) {
  if (to.meta.public) {
    // `expired` comes from the 401 handler: the API just refused this session, so going back would only repeat that.
    if (!authenticated || to.query.expired) return true;
    return safeNext(to.query.next);
  }
  if (authenticated) return true;
  return { path: "/login", query: to.fullPath === "/" ? {} : { next: to.fullPath } };
}
