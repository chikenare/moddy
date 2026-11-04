import { type Api, GrammyError } from "grammy";
import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { normalizeFormatted } from "../community/formatting.js";
import { type FormattedEntity, deleteAutoReply, getAutoReply, insertAutoReply, listAutoReplies, updateAutoReply } from "../db/auto-replies.js";
import { deleteChat, getChat, listChats, updateChatSettings } from "../db/chats.js";
import type { Db } from "../db/connection.js";
import { getEvent, isActiveBan, listEvents, markUnbanned } from "../db/events.js";
import { addWhitelistEntry, addWord, listWhitelist, listWords, removeWhitelistEntry, removeWord } from "../db/lists.js";
import { cancelMessage, createMessage, getMessage, listMessages } from "../db/messages.js";
import { addStaff, findSeenUser, listStaff, removeStaff } from "../db/staff.js";
import type { AppEnv } from "../env.js";
import { normalizeWhitelistEntry } from "../moderation/links.js";
import { normalizeWord } from "../moderation/normalize.js";
import { hostOriginGuard } from "./guard.js";

export type ApiTelegram = Pick<Api, "leaveChat" | "unbanChatMember" | "unbanChatSenderChat" | "getChatMember">;

const ID = "-?\\d+";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const USER_ID = /^\d{1,15}$/;
const USERNAME = /^@?([a-zA-Z][a-zA-Z0-9_]{3,31})$/;
const MAX_TRIGGERS = 20;
const MAX_REPLY = 4000;
const MAX_ENTITIES = 100;
const MAX_MESSAGE = 4000;
const SCHEDULE_TOLERANCE_SECONDS = 60;
const MAX_SCHEDULE_SECONDS = 366 * 24 * 60 * 60;

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
  rules: z.string().trim().max(4000),
  autoRepliesEnabled: z.boolean(),
}).partial().strict();

const textBody = (key: string) => z.object({ [key]: z.string() });
const entityBody = z.object({ type: z.string(), offset: z.number(), length: z.number(), url: z.string().optional() });
const autoReplyBody = z.object({ triggers: z.array(z.string()), reply: z.string(), entities: z.array(entityBody).max(1000).optional() });
const messageBody = z.object({ text: z.string(), chatIds: z.array(z.number().int()), sendAt: z.number().int().nullable() });

function parseAutoReply(data: z.infer<typeof autoReplyBody>): { triggers: string[]; reply: string; entities: FormattedEntity[] } | { error: string } {
  if (!data.triggers.length) return { error: "Add at least one trigger" };
  const normalized = data.triggers.map(normalizeWord);
  if (normalized.includes(null)) return { error: "Each trigger must be between 2 and 100 characters" };
  const triggers = [...new Set(normalized as string[])];
  if (triggers.length > MAX_TRIGGERS) return { error: `Use at most ${MAX_TRIGGERS} triggers` };
  const formatted = normalizeFormatted(data.reply, (data.entities ?? []) as FormattedEntity[]);
  if (!formatted) return { error: "Invalid formatting" };
  if (!formatted.text || formatted.text.length > MAX_REPLY) return { error: `Reply must be between 1 and ${MAX_REPLY} characters` };
  if (formatted.entities.length > MAX_ENTITIES) return { error: `Too much formatting: use at most ${MAX_ENTITIES} styled parts` };
  return { triggers, reply: formatted.text, entities: formatted.entities };
}

const fullName = (user: { first_name: string; last_name?: string }) => [user.first_name, user.last_name].filter(Boolean).join(" ");

function describeIssue(issue: z.core.$ZodIssue): string {
  if (issue.code === "unrecognized_keys") return `Fields not allowed: ${issue.keys.join(", ")}`;
  const field = issue.path.join(".");
  if (field.startsWith("entities")) return "Invalid formatting";
  if (field === "floodCount") return "Message count must be between 2 and 50";
  if (field === "floodSeconds") return "Seconds must be between 1 and 3600";
  if (field === "noticeTemplate") return "Notice must be between 1 and 500 characters";
  if (field === "rules") return "Rules must be at most 4000 characters";
  return field ? "Invalid value" : "Invalid body";
}

export function createApi(deps: {
  db: Db; telegram: ApiTelegram; appEnv: AppEnv;
  botUsername: () => string | null; onMessageQueued: () => void;
}): Hono {
  const { db, telegram, appEnv, botUsername, onMessageQueued } = deps;
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

  api.get("/messages", (c) => c.json({ messages: listMessages(db) }));
  api.post("/messages", async (c) => {
    const body = await readBody(c, messageBody);
    if ("response" in body) return body.response;
    const text = body.data.text.trim();
    if (!text || text.length > MAX_MESSAGE) return fail(c, 400, `Message must be between 1 and ${MAX_MESSAGE} characters`);
    const chatIds = [...new Set(body.data.chatIds)];
    if (!chatIds.length) return fail(c, 400, "Choose at least one chat");
    for (const id of chatIds) {
      const chat = getChat(db, id);
      if (!chat) return fail(c, 400, `Chat not available: ${id}`);
      if (chat.botStatus === "left" || chat.botStatus === "kicked") return fail(c, 400, `Chat not available: ${chat.title}`);
    }
    const now = Math.floor(Date.now() / 1000);
    const sendAt = body.data.sendAt ?? now;
    if (sendAt < now - SCHEDULE_TOLERANCE_SECONDS) return fail(c, 400, "Choose a time in the future");
    if (sendAt > now + MAX_SCHEDULE_SECONDS) return fail(c, 400, "Choose a time within the next year");
    const message = createMessage(db, text, chatIds, sendAt, now);
    onMessageQueued();
    return c.json(message, 201);
  });
  api.post("/messages/:messageId{\\d+}/cancel", (c) => {
    const id = Number(c.req.param("messageId"));
    if (!getMessage(db, id)) return fail(c, 404, "Message not found");
    if (!cancelMessage(db, id)) return fail(c, 409, "Nothing left to cancel");
    return c.json(getMessage(db, id)!);
  });

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

  api.get(`${chatRoute}/staff`, (c) => c.json({ staff: listStaff(db, chatId(c)) }));
  api.post(`${chatRoute}/staff`, async (c) => {
    const body = await readBody(c, textBody("user"));
    if ("response" in body) return body.response;
    const id = chatId(c);
    const raw = body.data.user!.trim();
    let userId: number;
    let displayName: string;
    if (USER_ID.test(raw)) {
      userId = Number(raw);
      try {
        const member = await telegram.getChatMember(id, userId);
        if (member.user.is_bot) return fail(c, 400, "Bots can't be staff");
        displayName = fullName(member.user);
      } catch (e) {
        if (e instanceof GrammyError && e.error_code === 400) return fail(c, 400, "User not found in this group");
        console.error(`Could not check user ${userId} in chat ${id}:`, e);
        return fail(c, 502, "Could not check the user on Telegram");
      }
    } else {
      const username = USERNAME.exec(raw)?.[1];
      if (!username) return fail(c, 400, "Enter a @username or a numeric user ID");
      const seen = findSeenUser(db, id, username);
      if (!seen) return fail(c, 400, `The bot hasn't seen @${username} in this group yet. Ask them to send a message, or add them by ID.`);
      userId = seen.userId;
      displayName = seen.displayName;
    }
    addStaff(db, id, userId, displayName);
    return c.json(listStaff(db, id).find((s) => s.userId === userId)!, 201);
  });
  api.delete(`${chatRoute}/staff/:userId{\\d+}`, (c) => {
    if (!removeStaff(db, chatId(c), Number(c.req.param("userId")))) return fail(c, 404, "Staff member not found");
    return c.body(null, 204);
  });

  const triggerConflict = (id: number, triggers: string[], selfId?: number) =>
    triggers.find((t) => listAutoReplies(db, id).some((r) => r.id !== selfId && r.triggers.includes(t)));

  api.get(`${chatRoute}/auto-replies`, (c) => c.json({ autoReplies: listAutoReplies(db, chatId(c)) }));
  api.post(`${chatRoute}/auto-replies`, async (c) => {
    const body = await readBody(c, autoReplyBody);
    if ("response" in body) return body.response;
    const parsed = parseAutoReply(body.data);
    if ("error" in parsed) return fail(c, 400, parsed.error);
    const id = chatId(c);
    const conflict = triggerConflict(id, parsed.triggers);
    if (conflict) return fail(c, 400, `Trigger already in use: ${conflict}`);
    return c.json(insertAutoReply(db, id, parsed.triggers, parsed.reply, parsed.entities), 201);
  });
  api.put(`${chatRoute}/auto-replies/:replyId{\\d+}`, async (c) => {
    const id = chatId(c);
    const replyId = Number(c.req.param("replyId"));
    if (!getAutoReply(db, id, replyId)) return fail(c, 404, "Auto reply not found");
    const body = await readBody(c, autoReplyBody);
    if ("response" in body) return body.response;
    const parsed = parseAutoReply(body.data);
    if ("error" in parsed) return fail(c, 400, parsed.error);
    const conflict = triggerConflict(id, parsed.triggers, replyId);
    if (conflict) return fail(c, 400, `Trigger already in use: ${conflict}`);
    return c.json(updateAutoReply(db, id, replyId, parsed.triggers, parsed.reply, parsed.entities)!);
  });
  api.delete(`${chatRoute}/auto-replies/:replyId{\\d+}`, (c) => {
    if (!deleteAutoReply(db, chatId(c), Number(c.req.param("replyId")))) return fail(c, 404, "Auto reply not found");
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
