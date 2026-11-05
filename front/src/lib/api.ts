export type ChatType = "group" | "supergroup" | "channel";
export type FilterAction = "delete" | "delete_ban";
export type FilterName = "link" | "word" | "flood" | "bot";
export type SenderType = "user" | "chat";

export interface ChatRecord {
  id: number; type: ChatType; title: string; username: string | null;
  botStatus: string; canDelete: boolean; canRestrict: boolean; linkedChatId: number | null;
  moderationEnabled: boolean;
  linkFilterEnabled: boolean; linkFilterAction: FilterAction;
  wordFilterEnabled: boolean; wordFilterAction: FilterAction;
  floodFilterEnabled: boolean; floodFilterAction: FilterAction;
  floodCount: number; floodSeconds: number;
  botFilterEnabled: boolean;
  noticeEnabled: boolean; noticeTemplate: string;
  rules: string; rulesEntities: FormattedEntity[]; autoRepliesEnabled: boolean;
  createdAt: number; updatedAt: number;
}
export type ChatSettings = Pick<ChatRecord, "moderationEnabled" | "linkFilterEnabled" | "linkFilterAction" | "wordFilterEnabled" | "wordFilterAction" | "floodFilterEnabled" | "floodFilterAction" | "floodCount" | "floodSeconds" | "botFilterEnabled" | "noticeEnabled" | "noticeTemplate" | "rules" | "rulesEntities" | "autoRepliesEnabled">;

export interface EventRecord {
  id: number; chatId: number; senderType: SenderType; senderId: number; senderName: string;
  filter: FilterName; matched: string; text: string | null; action: FilterAction;
  deleteOk: boolean | null; banOk: boolean | null; error: string | null;
  dryRun: boolean; unbannedAt: number | null; createdAt: number;
}

export interface StaffMember { userId: number; displayName: string; addedAt: number }
export interface FormattedEntity {
  type: "bold" | "italic" | "underline" | "strikethrough" | "spoiler" | "code" | "blockquote" | "text_link";
  offset: number;
  length: number;
  url?: string;
}
export interface FormattedMessage { text: string; entities: FormattedEntity[] }
export interface AutoReply { id: number; chatId: number; triggers: string[]; reply: string; entities: FormattedEntity[]; createdAt: number }
export type TargetStatus = "pending" | "sending" | "sent" | "failed" | "missed" | "cancelled";
export interface MessageTarget { chatId: number; title: string; status: TargetStatus; error: string | null; sentAt: number | null }
export interface ScheduledMessage {
  id: number; text: string; entities: FormattedEntity[]; sendAt: number; createdAt: number; recurringId: number | null; targets: MessageTarget[]
}
export interface RecurringMessage {
  id: number; text: string; entities: FormattedEntity[]; cron: string; timezone: string; enabled: boolean
  nextRunAt: number | null; lastRunAt: number | null; createdAt: number; chats: { id: number; title: string }[]
}
export interface RecurringInput { text: string; entities: FormattedEntity[]; chatIds: number[]; cron: string; timezone: string }

export type StatField =
  | "messages" | "joins" | "leaves" | "deleted" | "banned"
  | "link_hits" | "word_hits" | "flood_hits" | "bot_hits" | "auto_replies" | "broadcasts";
export type StatTotals = Record<StatField, number>;
export interface Metrics {
  days: number; from: string; to: string;
  totals: StatTotals; previous: StatTotals;
  series: Array<{ day: string } & StatTotals>;
  topWords: Array<{ value: string; count: number }>;
  topDomains: Array<{ value: string; count: number }>;
  topChats: Array<{ id: number; title: string; messages: number; actions: number }>;
}

export interface SessionState {
  authenticated: boolean;
  mustChangePassword: boolean;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch {
    throw new ApiError(0, "Could not connect to the server");
  }
  if (!res.ok) {
    // At login a 401 only means a wrong password. The session check never sends one, so it can only come from
    // something in between, and reloading would just ask again. Anywhere else the session has ended.
    if (res.status === 401 && path !== "/auth/login" && path !== "/auth/session") onUnauthorized?.();
    let message = `Error ${res.status}`;
    try {
      const data = await res.json();
      if (typeof data?.error === "string") message = data.error;
    } catch { /* non-JSON body */ }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const chat = (id: number) => `/chats/${id}`;

export const api = {
  // The page only appears after this answers, so a stalled tunnel must not leave it blank.
  session: () => request<SessionState>("GET", "/auth/session", undefined, AbortSignal.timeout(5000)),
  login: (username: string, password: string) => request<SessionState>("POST", "/auth/login", { username, password }),
  logout: () => request<void>("POST", "/auth/logout"),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<SessionState>("POST", "/auth/password", { currentPassword, newPassword }),
  info: () => request<{ appEnv: "development" | "production"; botUsername: string | null }>("GET", "/info"),
  metrics: (days: number, chatId?: number) =>
    request<Metrics>("GET", `/metrics?days=${days}${chatId === undefined ? "" : `&chatId=${chatId}`}`),
  listChats: () => request<ChatRecord[]>("GET", "/chats"),
  getChat: (id: number) => request<ChatRecord>("GET", chat(id)),
  updateChat: (id: number, patch: Partial<ChatSettings>) => request<ChatRecord>("PATCH", chat(id), patch),
  forgetChat: (id: number) => request<void>("DELETE", chat(id)),
  listWords: async (id: number) => (await request<{ words: string[] }>("GET", `${chat(id)}/words`)).words,
  addWord: async (id: number, word: string) => (await request<{ word: string }>("POST", `${chat(id)}/words`, { word })).word,
  removeWord: (id: number, word: string) => request<void>("DELETE", `${chat(id)}/words?word=${encodeURIComponent(word)}`),
  listWhitelist: async (id: number) => (await request<{ entries: string[] }>("GET", `${chat(id)}/whitelist`)).entries,
  addWhitelistEntry: async (id: number, entry: string) => (await request<{ entry: string }>("POST", `${chat(id)}/whitelist`, { entry })).entry,
  removeWhitelistEntry: (id: number, entry: string) => request<void>("DELETE", `${chat(id)}/whitelist?entry=${encodeURIComponent(entry)}`),
  listEvents: (id: number, before?: number) =>
    request<{ events: EventRecord[]; nextBefore: number | null }>("GET", `${chat(id)}/events${before === undefined ? "" : `?before=${before}`}`),
  unban: (id: number, eventId: number) => request<EventRecord>("POST", `${chat(id)}/events/${eventId}/unban`),
  listStaff: async (id: number) => (await request<{ staff: StaffMember[] }>("GET", `${chat(id)}/staff`)).staff,
  addStaff: (id: number, user: string) => request<StaffMember>("POST", `${chat(id)}/staff`, { user }),
  removeStaff: (id: number, userId: number) => request<void>("DELETE", `${chat(id)}/staff/${userId}`),
  listAutoReplies: async (id: number) => (await request<{ autoReplies: AutoReply[] }>("GET", `${chat(id)}/auto-replies`)).autoReplies,
  addAutoReply: (id: number, triggers: string[], message: FormattedMessage) =>
    request<AutoReply>("POST", `${chat(id)}/auto-replies`, { triggers, reply: message.text, entities: message.entities }),
  updateAutoReply: (id: number, replyId: number, triggers: string[], message: FormattedMessage) =>
    request<AutoReply>("PUT", `${chat(id)}/auto-replies/${replyId}`, { triggers, reply: message.text, entities: message.entities }),
  removeAutoReply: (id: number, replyId: number) => request<void>("DELETE", `${chat(id)}/auto-replies/${replyId}`),
  listMessages: async () => (await request<{ messages: ScheduledMessage[] }>("GET", "/messages")).messages,
  sendMessage: (message: FormattedMessage, chatIds: number[], sendAt: number | null) =>
    request<ScheduledMessage>("POST", "/messages", { text: message.text, entities: message.entities, chatIds, sendAt }),
  listRecurring: async () => (await request<{ recurring: RecurringMessage[] }>("GET", "/recurring")).recurring,
  previewRecurring: async (cron: string, timezone: string) =>
    (await request<{ nextRuns: number[] }>("GET", `/recurring/preview?cron=${encodeURIComponent(cron)}&timezone=${encodeURIComponent(timezone)}`)).nextRuns,
  createRecurring: (input: RecurringInput) => request<RecurringMessage>("POST", "/recurring", input),
  updateRecurring: (id: number, input: RecurringInput) => request<RecurringMessage>("PUT", `/recurring/${id}`, input),
  deleteRecurring: (id: number) => request<void>("DELETE", `/recurring/${id}`),
  pauseRecurring: (id: number) => request<RecurringMessage>("POST", `/recurring/${id}/pause`),
  resumeRecurring: (id: number) => request<RecurringMessage>("POST", `/recurring/${id}/resume`),
  cancelMessage: (id: number) => request<ScheduledMessage>("POST", `/messages/${id}/cancel`),
};
