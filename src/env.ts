export type AppEnv = "development" | "production";

export function parseAppEnv(value: string | undefined): AppEnv {
  if (value === "development" || value === "production") return value;
  throw new Error(
    `APP_ENV debe ser "development" o "production" (recibido: ${value === undefined ? "sin definir" : JSON.stringify(value)})`,
  );
}
