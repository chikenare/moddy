export type AppEnv = "development" | "production";

export function parseAppEnv(value: string | undefined): AppEnv {
  if (value === "development" || value === "production") return value;
  throw new Error(
    `APP_ENV must be "development" or "production" (got: ${value === undefined ? "undefined" : JSON.stringify(value)})`,
  );
}

const EXAMPLE_PASSWORD = "change-me-to-a-long-random-password";
const MIN_PASSWORD = 12;
// Both have to fit in a login request, which is limited to 4 KB.
const MAX_CREDENTIAL = 256;

export function parsePanelCredentials(user: string | undefined, password: string | undefined): { user: string; password: string } {
  if (!user) throw new Error("PANEL_USER is required");
  if (user.length > MAX_CREDENTIAL) throw new Error(`PANEL_USER must have at most ${MAX_CREDENTIAL} characters`);
  if (!password || password.trim().length < MIN_PASSWORD) throw new Error(`PANEL_PASSWORD must have at least ${MIN_PASSWORD} characters`);
  if (password.length > MAX_CREDENTIAL) throw new Error(`PANEL_PASSWORD must have at most ${MAX_CREDENTIAL} characters`);
  if (password === EXAMPLE_PASSWORD) throw new Error("PANEL_PASSWORD still has the example value");
  return { user, password };
}

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function parsePanelHost(value: string | undefined): string | null {
  if (!value) return null;
  const host = value.toLowerCase();
  if (!DOMAIN.test(host)) throw new Error(`PANEL_HOST must be a domain like panel.example.com, without https:// or a port (got: ${JSON.stringify(value)})`);
  return host;
}

export function parsePort(value: string | undefined): number {
  if (value === undefined) return 3000;
  const port = /^\d+$/.test(value) ? Number(value) : NaN;
  if (Number.isInteger(port) && port >= 1 && port <= 65535) return port;
  throw new Error(`API_PORT must be an integer between 1 and 65535 (got: ${JSON.stringify(value)})`);
}
