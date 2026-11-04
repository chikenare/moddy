export type AppEnv = "development" | "production";

export function parseAppEnv(value: string | undefined): AppEnv {
  if (value === "development" || value === "production") return value;
  throw new Error(
    `APP_ENV debe ser "development" o "production" (recibido: ${value === undefined ? "sin definir" : JSON.stringify(value)})`,
  );
}

export function parsePort(value: string | undefined): number {
  if (value === undefined) return 3000;
  const port = /^\d+$/.test(value) ? Number(value) : NaN;
  if (Number.isInteger(port) && port >= 1 && port <= 65535) return port;
  throw new Error(`API_PORT debe ser un entero entre 1 y 65535 (recibido: ${JSON.stringify(value)})`);
}
