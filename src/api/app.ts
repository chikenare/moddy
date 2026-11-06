import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { type Api, GrammyError } from "grammy";
import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { normalizeFormatted } from "../community/formatting.js";
import { type FormattedEntity, deleteAutoReply, getAutoReply, insertAutoReply, listAutoReplies, updateAutoReply } from "../db/auto-replies.js";
import { type ChatSettings, deleteChat, getChat, listChats, updateChatSettings } from "../db/chats.js";
import type { Db } from "../db/connection.js";
import { getEvent, isActiveBan, listEvents, markUnbanned } from "../db/events.js";
import { addWhitelistEntry, addWord, listWhitelist, listWords, removeWhitelistEntry, removeWord } from "../db/lists.js";
import { cancelMessage, createMessage, getMessage, listMessages } from "../db/messages.js";
import { type RecurringInput, createRecurring, deleteRecurring, getRecurring, listRecurring, setRecurringEnabled, updateRecurring } from "../db/recurring.js";
import { type NightMode, type NightNotice, type NightState, getNightMode, saveNightModeSettings, setNightOverride } from "../db/night-mode.js";
import { PERIODS, getMetrics } from "../db/stats.js";
import { addStaff, findSeenUser, listStaff, removeStaff } from "../db/staff.js";
import type { AppEnv } from "../env.js";
import { normalizeWhitelistEntry } from "../moderation/links.js";
import { nextRun, validateRecurrence } from "../messages/recurrence.js";
import { normalizeWord } from "../moderation/normalize.js";
import { isTime, isTimeZone, scheduledState } from "../night/schedule.js";
import { createAuth } from "./auth.js";
import { clearWarnings } from "../db/warnings.js";
import { hostOriginGuard } from "./guard.js";
import type { PhotoFetcher } from "./photos.js";

export type ApiTelegram = Pick<Api, "leaveChat" | "unbanChatMember" | "unbanChatSenderChat" | "getChatMember">;

const ID = "-?\\d+";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const USER_ID = /^\d{1,15}$/;
const USERNAME = /^@?([a-zA-Z][a-zA-Z0-9_]{3,31})$/;
const MAX_TRIGGERS = 20;
const MAX_REPLY = 4000;
const MAX_RULES = 4000;
const MAX_ENTITIES = 100;
const MAX_MESSAGE = 4000;
const SCHEDULE_TOLERANCE_SECONDS = 60;
const MAX_SCHEDULE_SECONDS = 366 * 24 * 60 * 60;

const entityBody = z.object({ type: z.string(), offset: z.number(), length: z.number(), url: z.string().optional() });
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
  // Not trimmed here: entity offsets refer to the text as typed; normalizeFormatted trims both together.
  rules: z.string(),
  rulesEntities: z.array(entityBody).max(1000),
  autoRepliesEnabled: z.boolean(),
  commandsEnabled: z.boolean(),
  warnLimit: z.number().int().min(1).max(20),
}).partial().strict();

const noticeBody = z.object({ enabled: z.boolean(), text: z.string(), entities: z.array(entityBody).max(1000) });
const nightModeBody = z.object({
  enabled: z.boolean(),
  closeTime: z.string(), openTime: z.string(), timezone: z.string(),
  days: z.array(z.number().int().min(0).max(6)).max(7),
  closeNotice: noticeBody, openNotice: noticeBody,
  deleteCloseNotice: z.boolean(),
}).strict();

const textBody = (key: string) => z.object({ [key]: z.string() });
const autoReplyBody = z.object({ triggers: z.array(z.string()), reply: z.string(), entities: z.array(entityBody).max(1000).optional() });
const messageBody = z.object({
  text: z.string(), entities: z.array(entityBody).max(1000).optional(),
  chatIds: z.array(z.number().int()), sendAt: z.number().int().nullable(),
});
const recurringBody = z.object({
  text: z.string(), entities: z.array(entityBody).max(1000).optional(),
  chatIds: z.array(z.number().int()), cron: z.string(), timezone: z.string(),
});

function parseMessageText(text: string, entities: unknown[] | undefined): { text: string; entities: FormattedEntity[] } | { error: string } {
  const formatted = normalizeFormatted(text, (entities ?? []) as FormattedEntity[]);
  if (!formatted) return { error: "Invalid formatting" };
  if (!formatted.text || formatted.text.length > MAX_MESSAGE) return { error: `Message must be between 1 and ${MAX_MESSAGE} characters` };
  if (formatted.entities.length > MAX_ENTITIES) return { error: `Too much formatting: use at most ${MAX_ENTITIES} styled parts` };
  return formatted;
}

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

function parseNotice(notice: z.infer<typeof noticeBody>): NightNotice | string {
  const formatted = normalizeFormatted(notice.text, notice.entities as FormattedEntity[]);
  if (!formatted) return "Invalid formatting";
  if (formatted.text.length > MAX_MESSAGE) return `Notices must be at most ${MAX_MESSAGE} characters`;
  if (formatted.entities.length > MAX_ENTITIES) return `Too much formatting: use at most ${MAX_ENTITIES} styled parts`;
  if (notice.enabled && !formatted.text) return "Write the notice, or turn it off";
  return { enabled: notice.enabled, ...formatted };
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
  if (field === "warnLimit") return "Warnings must be between 1 and 20";
  if (field.startsWith("days")) return "Days must be weekdays from 0 (Sunday) to 6";
  if (field.endsWith("entities")) return "Invalid formatting";
  return field ? "Invalid value" : "Invalid body";
}

// Inline styles stay allowed because Vue and the UI components set them; scripts only come from the panel itself.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function createApi(deps: {
  db: Db; telegram: ApiTelegram; appEnv: AppEnv;
  botUsername: () => string | null; onMessageQueued: () => void;
  // Resolves once the worker has applied a change, so the reply already shows the group closed or open.
  onNightModeChanged?: () => Promise<void>;
  fetchPhoto: PhotoFetcher; panelDir?: string | null; panelHost?: string | null;
  now?: () => number;
}): Hono {
  const { db, telegram, appEnv, botUsername, onMessageQueued, fetchPhoto, panelDir } = deps;
  const onNightModeChanged = deps.onNightModeChanged ?? (async () => {});
  const app = new Hono();
  const api = new Hono();

  api.use("*", hostOriginGuard(deps.panelHost));
  const auth = createAuth({ db, now: deps.now ?? Date.now });
  api.use("*", auth.requireSession);
  api.route("/auth", auth.routes);

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
    const revoked = auth.refuseIfRevoked(c);
    if (revoked) return { response: revoked };
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { response: fail(c, 400, describeIssue(parsed.error.issues[0]!)) };
    return { data: parsed.data };
  }

  function checkChats(ids: number[]): number[] | string {
    const chatIds = [...new Set(ids)];
    if (!chatIds.length) return "Choose at least one chat";
    for (const id of chatIds) {
      const chat = getChat(db, id);
      if (!chat) return `Chat not available: ${id}`;
      if (chat.botStatus === "left" || chat.botStatus === "kicked") return `Chat not available: ${chat.title}`;
    }
    return chatIds;
  }

  api.get("/health", (c) => c.json({ status: "ok" }));
  api.get("/info", (c) => c.json({ appEnv, botUsername: botUsername() }));
  api.get("/chats", (c) => c.json(listChats(db)));

  api.get("/metrics", (c) => {
    const days = Number(c.req.query("days") ?? 30);
    if (!(PERIODS as readonly number[]).includes(days)) return fail(c, 400, "Days must be 7, 30 or 90");
    const raw = c.req.query("chatId");
    let scope: number | undefined;
    if (raw !== undefined && raw !== "") {
      scope = Number(raw);
      if (!Number.isSafeInteger(scope) || !getChat(db, scope)) return fail(c, 404, "Chat not found");
    }
    return c.json(getMetrics(db, { days, chatId: scope, nowMs: Date.now() }));
  });

  api.get("/messages", (c) => c.json({ messages: listMessages(db) }));
  api.post("/messages", async (c) => {
    const body = await readBody(c, messageBody);
    if ("response" in body) return body.response;
    const formatted = parseMessageText(body.data.text, body.data.entities);
    if ("error" in formatted) return fail(c, 400, formatted.error);
    const chatIds = checkChats(body.data.chatIds);
    if (typeof chatIds === "string") return fail(c, 400, chatIds);
    const now = Math.floor(Date.now() / 1000);
    const sendAt = body.data.sendAt ?? now;
    if (sendAt < now - SCHEDULE_TOLERANCE_SECONDS) return fail(c, 400, "Choose a time in the future");
    if (sendAt > now + MAX_SCHEDULE_SECONDS) return fail(c, 400, "Choose a time within the next year");
    const message = createMessage(db, formatted.text, chatIds, sendAt, now, { entities: formatted.entities });
    onMessageQueued();
    return c.json(message, 201);
  });
  api.post("/messages/:messageId{\\d+}/cancel", (c) => {
    const id = Number(c.req.param("messageId"));
    if (!getMessage(db, id)) return fail(c, 404, "Message not found");
    if (!cancelMessage(db, id)) return fail(c, 409, "Nothing left to cancel");
    return c.json(getMessage(db, id)!);
  });

  const nowSeconds = () => Math.floor(Date.now() / 1000);

  // Shared by create and edit: returns what the store needs, or the message to show.
  async function parseRecurring(c: Ctx): Promise<{ input: Omit<RecurringInput, "nextRunAt">; nextRunAt: number } | { response: Response }> {
    const body = await readBody(c, recurringBody);
    if ("response" in body) return body;
    const formatted = parseMessageText(body.data.text, body.data.entities);
    if ("error" in formatted) return { response: fail(c, 400, formatted.error) };
    const chatIds = checkChats(body.data.chatIds);
    if (typeof chatIds === "string") return { response: fail(c, 400, chatIds) };
    const cron = body.data.cron.trim();
    const check = validateRecurrence(cron, body.data.timezone, nowSeconds());
    if ("error" in check) return { response: fail(c, 400, check.error) };
    return { input: { text: formatted.text, entities: formatted.entities, cron, timezone: body.data.timezone, chatIds }, nextRunAt: check.nextRuns[0]! };
  }

  api.get("/recurring", (c) => c.json({ recurring: listRecurring(db) }));
  api.get("/recurring/preview", (c) => {
    const check = validateRecurrence((c.req.query("cron") ?? "").trim(), c.req.query("timezone") ?? "", nowSeconds());
    return "error" in check ? fail(c, 400, check.error) : c.json({ nextRuns: check.nextRuns });
  });
  api.post("/recurring", async (c) => {
    const parsed = await parseRecurring(c);
    if ("response" in parsed) return parsed.response;
    return c.json(createRecurring(db, { ...parsed.input, nextRunAt: parsed.nextRunAt }), 201);
  });
  api.put("/recurring/:rid{\\d+}", async (c) => {
    const id = Number(c.req.param("rid"));
    const current = getRecurring(db, id);
    if (!current) return fail(c, 404, "Recurring message not found");
    const parsed = await parseRecurring(c);
    if ("response" in parsed) return parsed.response;
    return c.json(updateRecurring(db, id, { ...parsed.input, nextRunAt: current.enabled ? parsed.nextRunAt : null })!);
  });
  api.delete("/recurring/:rid{\\d+}", (c) => {
    if (!deleteRecurring(db, Number(c.req.param("rid")))) return fail(c, 404, "Recurring message not found");
    return c.body(null, 204);
  });
  api.post("/recurring/:rid{\\d+}/pause", (c) => {
    const id = Number(c.req.param("rid"));
    if (!getRecurring(db, id)) return fail(c, 404, "Recurring message not found");
    return c.json(setRecurringEnabled(db, id, false, null)!);
  });
  api.post("/recurring/:rid{\\d+}/resume", (c) => {
    const id = Number(c.req.param("rid"));
    const rule = getRecurring(db, id);
    if (!rule) return fail(c, 404, "Recurring message not found");
    if (!rule.chats.length) return fail(c, 409, "This message has no chats left");
    return c.json(setRecurringEnabled(db, id, true, nextRun(rule.cron, rule.timezone, nowSeconds()))!);
  });

  const chatRoute = `/chats/:id{${ID}}`;
  api.use(`${chatRoute}/*`, async (c, next) => {
    if (!getChat(db, chatId(c))) return fail(c, 404, "Chat not found");
    await next();
  });

  api.get(chatRoute, (c) => c.json(getChat(db, chatId(c))!));

  api.get(`${chatRoute}/photo`, async (c) => {
    const photo = await fetchPhoto(chatId(c));
    if (!photo) return fail(c, 404, "This chat has no photo");
    return c.body(photo as Uint8Array<ArrayBuffer>, 200, { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" });
  });

  api.patch(chatRoute, async (c) => {
    const body = await readBody(c, patchSchema);
    if ("response" in body) return body.response;
    const id = chatId(c);
    if (body.data.moderationEnabled && getChat(db, id)!.type === "channel") {
      return fail(c, 400, "A channel cannot be moderated: it has no messages from other users");
    }
    const { rulesEntities: _ignored, ...rest } = body.data;
    const patchData: Partial<ChatSettings> = { ...rest };
    if (body.data.rules !== undefined || body.data.rulesEntities !== undefined) {
      const current = getChat(db, id)!;
      // Text without formatting means the new text is plain; formatting alone applies to the stored text.
      const text = body.data.rules ?? current.rules;
      const entities = (body.data.rulesEntities ?? (body.data.rules !== undefined ? [] : current.rulesEntities)) as FormattedEntity[];
      const formatted = normalizeFormatted(text, entities);
      if (!formatted) return fail(c, 400, "Invalid formatting");
      if (formatted.text.length > MAX_RULES) return fail(c, 400, `Rules must be at most ${MAX_RULES} characters`);
      if (formatted.entities.length > MAX_ENTITIES) return fail(c, 400, `Too much formatting: use at most ${MAX_ENTITIES} styled parts`);
      patchData.rules = formatted.text;
      patchData.rulesEntities = formatted.entities;
    }
    return c.json(updateChatSettings(db, id, patchData)!);
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

  // What the panel needs; the saved permissions and message ids stay inside.
  const nightView = (n: NightMode) => ({
    enabled: n.enabled, closeTime: n.closeTime, openTime: n.openTime, timezone: n.timezone, days: n.days,
    closeNotice: n.closeNotice, openNotice: n.openNotice, deleteCloseNotice: n.deleteCloseNotice,
    configured: n.configured, state: n.state, override: n.override, error: n.error,
  });
  const noNightMode = (c: Ctx) =>
    getChat(db, chatId(c))!.type === "channel" ? fail(c, 400, "A channel has no members writing, so it can't be closed") : null;

  api.get(`${chatRoute}/night-mode`, (c) => c.json(nightView(getNightMode(db, chatId(c)))));

  api.put(`${chatRoute}/night-mode`, async (c) => {
    const refused = noNightMode(c);
    if (refused) return refused;
    const body = await readBody(c, nightModeBody);
    if ("response" in body) return body.response;
    const d = body.data;
    if (!isTime(d.closeTime) || !isTime(d.openTime)) return fail(c, 400, "Times must be HH:MM, from 00:00 to 23:59");
    if (d.closeTime === d.openTime) return fail(c, 400, "The closing and opening times must be different");
    if (!isTimeZone(d.timezone)) return fail(c, 400, `Unknown time zone: ${d.timezone}`);
    if (d.enabled && !d.days.length) return fail(c, 400, "Choose at least one night");
    const closeNotice = parseNotice(d.closeNotice);
    if (typeof closeNotice === "string") return fail(c, 400, closeNotice);
    const openNotice = parseNotice(d.openNotice);
    if (typeof openNotice === "string") return fail(c, 400, openNotice);
    const id = chatId(c);
    saveNightModeSettings(db, id, { ...d, closeNotice, openNotice });
    await onNightModeChanged();
    return c.json(nightView(getNightMode(db, id)));
  });

  for (const [path, state] of [["close", "closed"], ["open", "open"]] as [string, NightState][]) {
    api.post(`${chatRoute}/night-mode/${path}`, async (c) => {
      const refused = noNightMode(c);
      if (refused) return refused;
      const id = chatId(c);
      setNightOverride(db, id, state, scheduledState(getNightMode(db, id), nowSeconds()));
      await onNightModeChanged();
      return c.json(nightView(getNightMode(db, id)));
    });
  }

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
    clearWarnings(db, id, event.senderId);
    return c.json(getEvent(db, id, event.id)!);
  });

  api.notFound((c) => fail(c, 404, "Route not found"));
  api.onError((e, c) => {
    // A client hanging up is not a fault, and logging it would let anyone who can reach the login fill the disk.
    if ((e as NodeJS.ErrnoException).code !== "ECONNRESET") console.error("API error:", e);
    return fail(c, 500, "Internal error");
  });

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Frame-Options", "DENY");
    c.header("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "same-origin");
  });

  app.route("/api", api);

  const isApi = (path: string) => path === "/api" || path.startsWith("/api/");
  if (panelDir) {
    const files = serveStatic({ root: panelDir });
    app.use("*", async (c, next) => {
      if (isApi(c.req.path)) return next();
      let served = true;
      const response = await files(c, async () => {
        served = false;
        await next();
      });
      if (!served || !response) return;
      // Vite hashes everything under /assets/, so those never change; the rest must be revalidated.
      response.headers.set("Cache-Control", c.req.path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
      return response;
    });
    app.notFound((c) => {
      const spaRoute = (c.req.method === "GET" || c.req.method === "HEAD") && !isApi(c.req.path) && !c.req.path.startsWith("/assets/");
      if (!spaRoute) return c.json({ error: "Route not found" }, 404);
      c.header("Cache-Control", "no-cache");
      return c.html(readFileSync(join(panelDir, "index.html"), "utf8"));
    });
  } else {
    app.notFound((c) => c.json({ error: "Route not found" }, 404));
  }
  return app;
}
