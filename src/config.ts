import { parseAppEnv, parsePanelCredentials, parsePanelHost, parsePort } from "./env.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

const appEnv = parseAppEnv(process.env.APP_ENV);

export const config = {
  botToken: required("BOT_TOKEN"),
  appEnv,
  apiPort: parsePort(process.env.API_PORT),
  panelDir: process.env.PANEL_DIR || null,
  panelCredentials: parsePanelCredentials(process.env.PANEL_USER, process.env.PANEL_PASSWORD),
  panelHost: parsePanelHost(process.env.PANEL_HOST),
  databasePath: process.env.DATABASE_PATH ?? `./data/${appEnv}.sqlite`,
} as const;
