import { type Api, GrammyError } from "grammy";
import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { deleteChat, getChat, listChats, updateChatSettings } from "../db/chats.js";
import type { Db } from "../db/connection.js";
import { getEvent, isActiveBan, listEvents, markUnbanned } from "../db/events.js";
import { addWhitelistEntry, addWord, listWhitelist, listWords, removeWhitelistEntry, removeWord } from "../db/lists.js";
import type { AppEnv } from "../env.js";
import { normalizeWhitelistEntry } from "../moderation/links.js";
import { normalizeWord } from "../moderation/normalize.js";
import { hostOriginGuard } from "./guard.js";

export type ApiTelegram = Pick<Api, "leaveChat" | "unbanChatMember" | "unbanChatSenderChat">;

const ID = "-?\\d+";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const action = z.enum(["delete", "delete_ban"]);
const patchSchema = z.object({
  moderationEnabled: z.boolean(),
  linkFilterEnabled: z.boolean(), linkFilterAction: action,
  wordFilterEnabled: z.boolean(), wordFilterAction: action,
  floodFilterEnabled: z.boolean(), floodFilterAction: action,
  floodCount: z.number().int().min(2).max(50),
  floodSeconds: z.number().int().min(1).max(3600),
  botFilterEnabled: z.boolean(),
}).partial().strict();

const textBody = (key: string) => z.object({ [key]: z.string() });

function describeIssue(issue: z.core.$ZodIssue): string {
  if (issue.code === "unrecognized_keys") return `Campos no permitidos: ${issue.keys.join(", ")}`;
  const field = issue.path.join(".");
  if (field === "floodCount") return "El número de mensajes debe estar entre 2 y 50";
  if (field === "floodSeconds") return "Los segundos deben estar entre 1 y 3600";
  return field ? "Valor no válido" : "Cuerpo inválido";
}

export function createApi(deps: { db: Db; telegram: ApiTelegram; appEnv: AppEnv }): Hono {
  const { db, telegram, appEnv } = deps;
  const app = new Hono();
  const api = new Hono();

  api.use("*", hostOriginGuard);

  type Ctx = Context<any, any, any>;
  const fail = (c: Ctx, status: ContentfulStatusCode, error: string) => c.json({ error }, status);
  const chatId = (c: Ctx) => Number(c.req.param("id"));

  async function readBody<S extends z.ZodType>(c: Ctx, schema: S): Promise<{ data: z.infer<S> } | { response: Response }> {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return { response: fail(c, 400, "JSON mal formado") };
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { response: fail(c, 400, describeIssue(parsed.error.issues[0]!)) };
    return { data: parsed.data };
  }

  api.get("/health", (c) => c.json({ status: "ok", appEnv }));
  api.get("/chats", (c) => c.json(listChats(db)));

  const chatRoute = `/chats/:id{${ID}}`;
  api.use(`${chatRoute}/*`, async (c, next) => {
    if (!getChat(db, chatId(c))) return fail(c, 404, "Chat no encontrado");
    await next();
  });

  api.get(chatRoute, (c) => c.json(getChat(db, chatId(c))!));

  api.patch(chatRoute, async (c) => {
    const body = await readBody(c, patchSchema);
    if ("response" in body) return body.response;
    const id = chatId(c);
    if (body.data.moderationEnabled && getChat(db, id)!.type === "channel") {
      return fail(c, 400, "Un canal no se puede moderar: no tiene mensajes de otros usuarios");
    }
    return c.json(updateChatSettings(db, id, body.data)!);
  });

  api.delete(chatRoute, async (c) => {
    const id = chatId(c);
    try {
      await telegram.leaveChat(id);
    } catch (e) {
      const gone = e instanceof GrammyError && (e.error_code === 400 || e.error_code === 403);
      if (!gone) {
        console.error(`No se pudo salir del chat ${id}:`, e);
        return fail(c, 502, "No se pudo salir del chat en Telegram");
      }
    }
    deleteChat(db, id);
    return c.body(null, 204);
  });

  api.get(`${chatRoute}/words`, (c) => c.json({ words: listWords(db, chatId(c)) }));
  api.post(`${chatRoute}/words`, async (c) => {
    const body = await readBody(c, textBody("word"));
    if ("response" in body) return body.response;
    const word = normalizeWord(body.data.word!);
    if (word === null) return fail(c, 400, "La palabra debe tener al menos 2 caracteres");
    addWord(db, chatId(c), word);
    return c.json({ word }, 201);
  });
  api.delete(`${chatRoute}/words`, (c) => {
    const word = c.req.query("word");
    if (word === undefined || !removeWord(db, chatId(c), word)) return fail(c, 404, "Palabra no encontrada");
    return c.body(null, 204);
  });

  api.get(`${chatRoute}/whitelist`, (c) => c.json({ entries: listWhitelist(db, chatId(c)) }));
  api.post(`${chatRoute}/whitelist`, async (c) => {
    const body = await readBody(c, textBody("entry"));
    if ("response" in body) return body.response;
    const entry = normalizeWhitelistEntry(body.data.entry!);
    if (entry === null) return fail(c, 400, "Enlace o dominio no válido");
    addWhitelistEntry(db, chatId(c), entry);
    return c.json({ entry }, 201);
  });
  api.delete(`${chatRoute}/whitelist`, (c) => {
    const entry = c.req.query("entry");
    if (entry === undefined || !removeWhitelistEntry(db, chatId(c), entry)) return fail(c, 404, "Entrada no encontrada");
    return c.body(null, 204);
  });

  api.get(`${chatRoute}/events`, (c) => {
    const limitRaw = c.req.query("limit");
    const beforeRaw = c.req.query("before");
    if (limitRaw !== undefined && !/^\d+$/.test(limitRaw)) return fail(c, 400, "limit no válido");
    if (beforeRaw !== undefined && !/^\d+$/.test(beforeRaw)) return fail(c, 400, "before no válido");
    const limit = limitRaw === undefined ? DEFAULT_LIMIT : Number(limitRaw);
    if (limit < 1 || limit > MAX_LIMIT) return fail(c, 400, `limit debe estar entre 1 y ${MAX_LIMIT}`);
    const page = listEvents(db, chatId(c), { limit: limit + 1, before: beforeRaw === undefined ? undefined : Number(beforeRaw) });
    const events = page.slice(0, limit);
    return c.json({ events, nextBefore: page.length > limit ? events[events.length - 1]!.id : null });
  });

  api.post(`${chatRoute}/events/:eventId{${ID}}/unban`, async (c) => {
    const id = chatId(c);
    const event = getEvent(db, id, Number(c.req.param("eventId")));
    if (!event) return fail(c, 404, "Evento no encontrado");
    if (!isActiveBan(event)) return fail(c, 409, "Este evento no tiene un bloqueo activo que deshacer");
    try {
      if (event.senderType === "chat") await telegram.unbanChatSenderChat(id, event.senderId);
      else await telegram.unbanChatMember(id, event.senderId, { only_if_banned: true });
    } catch (e) {
      console.error(`No se pudo desbanear en el chat ${id}:`, e);
      return fail(c, 502, "Telegram no pudo deshacer el bloqueo");
    }
    markUnbanned(db, id, event.senderType, event.senderId, Math.floor(Date.now() / 1000));
    return c.json(getEvent(db, id, event.id)!);
  });

  api.notFound((c) => fail(c, 404, "Ruta no encontrada"));
  api.onError((e, c) => {
    console.error("Error en la API:", e);
    return fail(c, 500, "Error interno");
  });

  app.route("/api", api);
  app.notFound((c) => c.json({ error: "Ruta no encontrada" }, 404));
  return app;
}
