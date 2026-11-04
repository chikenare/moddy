function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

export const config = {
  botToken: required("BOT_TOKEN"),
  apiBaseUrl: (process.env.API_BASE_URL ?? "https://api.playhub-plus.com").replace(/\/$/, ""),
  /** Cuántas Stars se cobran por cada 1 USD del precio del plan. */
  starsPerUsd: Number(process.env.STARS_PER_USD ?? 77),
  /** IDs de Telegram con permisos de administrador (separados por coma). */
  adminIds: (process.env.ADMIN_IDS ?? "")
    .split(",")
    .map((id) => Number(id.trim()))
    .filter((id) => Number.isInteger(id) && id > 0),
  supportContact: process.env.SUPPORT_CONTACT ?? "",
} as const;
