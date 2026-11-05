export const CHANGE_PASSWORD_PATH = "/change-password";

// Where to go after logging in. Only paths inside the panel, so a crafted link can't send the owner elsewhere.
export function safeNext(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  const path = next.split("?")[0];
  return path === "/login" || path === CHANGE_PASSWORD_PATH ? "/" : next;
}

interface Destination {
  fullPath: string;
  path: string;
  meta: { public?: boolean };
  query: { next?: unknown; expired?: unknown };
}

interface Session {
  authenticated: boolean;
  mustChangePassword: boolean;
}

// Where a navigation ends up, given the session.
export function guardRoute(to: Destination, session: Session) {
  const remembering = (path: string) => ({ path, query: to.fullPath === "/" ? {} : { next: to.fullPath } });
  if (to.meta.public) {
    // `expired` comes from the 401 handler: the API just refused this session, so going back would only repeat that.
    if (!session.authenticated || to.query.expired) return true;
    return safeNext(to.query.next);
  }
  if (!session.authenticated) return remembering("/login");
  if (session.mustChangePassword && to.path !== CHANGE_PASSWORD_PATH) return remembering(CHANGE_PASSWORD_PATH);
  return true;
}
