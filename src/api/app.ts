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
  noticeEnabled: z.boolean(),
  noticeTemplate: z.string().trim().min(1).max(500),
}).partial().strict();

const textBody = (key: string) => z.object({ [key]: z.string() });

function describeIssue(issue: z.core.$ZodIssue): string {
  if (issue.code === "unrecognized_keys") return `Fields not allowed: ${issue.keys.join(", ")}`;
  const field = issue.path.join(".");
  if (field === "floodCount") return "Message count must be between 2 and 50";
  if (field === "floodSeconds") return "Seconds must be between 1 and 3600";
  if (field === "noticeTemplate") return "Notice must be between 1 and 500 characters";
  return field ? "Invalid value" : "Invalid body";
}

export function createApi(deps: { db: Db; telegram: ApiTelegram; appEnv: AppEnv; botUsername: () => string | null }): Hono {
  const { db, telegram, appEnv, botUsername } = deps;
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
      return { response: fail(c, 400, "Malformed JSON") };
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { response: fail(c, 400, describeIssue(parsed.error.issues[0]!)) };
    return { data: parsed.data };
  }

  api.get("/health", (c) => c.json({ status: "ok", appEnv, botUsername: botUsername() }));
  api.get("/chats", (c) => c.json(listChats(db)));

  const chatRoute = `/chats/:id{${ID}}`;
  api.use(`${chatRoute}/*`, async (c, next) => {
    if (!getChat(db, chatId(c))) return fail(c, 404, "Chat not found");
    await next();
  });

  api.get(chatRoute, (c) => c.json(getChat(db, chatId(c))!));

  api.patch(chatRoute, async (c) => {
    const body = await readBody(c, patchSchema);
    if ("response" in body) return body.response;
    const id = chatId(c);
    if (body.data.moderationEnabled && getChat(db, id)!.type === "channel") {
      return fail(c, 400, "A channel cannot be moderated: it has no messages from other users");
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
        console.error(`Could not leave chat ${id}:`, e);
        return fail(c, 502, "Could not leave the chat on Telegram");
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
    if (word === null) return fail(c, 400, "Word must be between 2 and 100 characters");
    addWord(db, chatId(c), word);
    return c.json({ word }, 201);
  });
  api.delete(`${chatRoute}/words`, (c) => {
    const word = c.req.query("word");
    if (word === undefined || !removeWord(db, chatId(c), word)) return fail(c, 404, "Word not found");
    return c.body(null, 204);
  });

  api.get(`${chatRoute}/whitelist`, (c) => c.json({ entries: listWhitelist(db, chatId(c)) }));
  api.post(`${chatRoute}/whitelist`, async (c) => {
    const body = await readBody(c, textBody("entry"));
    if ("response" in body) return body.response;
    const entry = normalizeWhitelistEntry(body.data.entry!);
    if (entry === null) return fail(c, 400, "Invalid link or domain");
    addWhitelistEntry(db, chatId(c), entry);
    return c.json({ entry }, 201);
  });
  api.delete(`${chatRoute}/whitelist`, (c) => {
    const entry = c.req.query("entry");
    if (entry === undefined || !removeWhitelistEntry(db, chatId(c), entry)) return fail(c, 404, "Entry not found");
    return c.body(null, 204);
  });

  api.get(`${chatRoute}/events`, (c) => {
    const limitRaw = c.req.query("limit");
    const beforeRaw = c.req.query("before");
    if (limitRaw !== undefined && !/^\d+$/.test(limitRaw)) return fail(c, 400, "Invalid limit");
    if (beforeRaw !== undefined && !/^\d+$/.test(beforeRaw)) return fail(c, 400, "Invalid before");
    const limit = limitRaw === undefined ? DEFAULT_LIMIT : Number(limitRaw);
    if (limit < 1 || limit > MAX_LIMIT) return fail(c, 400, `limit must be between 1 and ${MAX_LIMIT}`);
    const page = listEvents(db, chatId(c), { limit: limit + 1, before: beforeRaw === undefined ? undefined : Number(beforeRaw) });
    const events = page.slice(0, limit);
    return c.json({ events, nextBefore: page.length > limit ? events[events.length - 1]!.id : null });
  });

  api.post(`${chatRoute}/events/:eventId{${ID}}/unban`, async (c) => {
    const id = chatId(c);
    const event = getEvent(db, id, Number(c.req.param("eventId")));
    if (!event) return fail(c, 404, "Event not found");
    if (!isActiveBan(event)) return fail(c, 409, "This event has no active ban to undo");
    try {
      if (event.senderType === "chat") await telegram.unbanChatSenderChat(id, event.senderId);
      else await telegram.unbanChatMember(id, event.senderId, { only_if_banned: true });
    } catch (e) {
      console.error(`Could not unban in chat ${id}:`, e);
      return fail(c, 502, "Telegram could not undo the ban");
    }
    markUnbanned(db, id, event.senderType, event.senderId, Math.floor(Date.now() / 1000));
    return c.json(getEvent(db, id, event.id)!);
  });

  api.notFound((c) => fail(c, 404, "Route not found"));
  api.onError((e, c) => {
    console.error("API error:", e);
    return fail(c, 500, "Internal error");
  });

  app.route("/api", api);
  app.notFound((c) => c.json({ error: "Route not found" }, 404));
  return app;
}
