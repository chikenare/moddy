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
  createdAt: number; updatedAt: number;
}
export type ChatSettings = Pick<ChatRecord, "moderationEnabled" | "linkFilterEnabled" | "linkFilterAction" | "wordFilterEnabled" | "wordFilterAction" | "floodFilterEnabled" | "floodFilterAction" | "floodCount" | "floodSeconds" | "botFilterEnabled" | "noticeEnabled" | "noticeTemplate">;

export interface EventRecord {
  id: number; chatId: number; senderType: SenderType; senderId: number; senderName: string;
  filter: FilterName; matched: string; text: string | null; action: FilterAction;
  deleteOk: boolean | null; banOk: boolean | null; error: string | null;
  dryRun: boolean; unbannedAt: number | null; createdAt: number;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Could not connect to the server");
  }
  if (!res.ok) {
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
  health: () => request<{ status: string; appEnv: "development" | "production"; botUsername: string | null }>("GET", "/health"),
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
};
