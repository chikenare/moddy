import { parseAppEnv } from "./env.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

const appEnv = parseAppEnv(process.env.APP_ENV);

export const config = {
  botToken: required("BOT_TOKEN"),
  appEnv,
  apiPort: Number(process.env.API_PORT ?? 3000),
  databasePath: process.env.DATABASE_PATH ?? `./data/${appEnv}.sqlite`,
} as const;
