export type AppEnv = "development" | "production";

export function parseAppEnv(value: string | undefined): AppEnv {
  if (value === "development" || value === "production") return value;
  throw new Error(
    `APP_ENV must be "development" or "production" (got: ${value === undefined ? "undefined" : JSON.stringify(value)})`,
  );
}

export function parsePort(value: string | undefined): number {
  if (value === undefined) return 3000;
  const port = /^\d+$/.test(value) ? Number(value) : NaN;
  if (Number.isInteger(port) && port >= 1 && port <= 65535) return port;
  throw new Error(`API_PORT must be an integer between 1 and 65535 (got: ${JSON.stringify(value)})`);
}
