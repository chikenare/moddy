import { type Api, GrammyError } from "grammy";
import type { Db } from "../db/connection.js";
import type { FilterAction } from "../db/chats.js";
import { type FilterName, insertEvent } from "../db/events.js";
import type { AppEnv } from "../env.js";
import type { Sender } from "./sender.js";

export interface Violation {
  chatId: number; sender: Sender; filter: FilterName; matched: string;
  text: string | null; action: FilterAction; messageIds: number[];
  adminCheckUserId: number | null;
}
export type EnforcerApi = Pick<Api, "getChatMember" | "deleteMessages" | "banChatMember" | "banChatSenderChat">;

const BATCH = 100;
const ATTEMPTS = 3;
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createEnforcer(deps: { api: EnforcerApi; db: Db; appEnv: AppEnv; sleep?: (ms: number) => Promise<void> }) {
  const { api, db, appEnv } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const tails = new Map<number, Promise<void>>();

  async function withRetry<T>(call: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await call();
      } catch (e) {
        if (!(e instanceof GrammyError) || e.error_code !== 429 || attempt >= ATTEMPTS) throw e;
        await sleep((e.parameters.retry_after ?? 1) * 1000);
      }
    }
  }

  async function process(v: Violation): Promise<void> {
    const production = appEnv === "production";
    let deleteOk: boolean | null = null;
    let banOk: boolean | null = null;
    const errors: string[] = [];

    const record = () => {
      try {
        insertEvent(db, {
          chatId: v.chatId, senderType: v.sender.type, senderId: v.sender.id, senderName: v.sender.name,
          filter: v.filter, matched: v.matched, text: v.text, action: v.action, deleteOk, banOk,
          error: errors.length ? errors.join("; ") : null,
          dryRun: !production && v.action === "delete_ban",
        });
      } catch (e) {
        console.error(`No se pudo registrar el evento del chat ${v.chatId}:`, e);
      }
    };

    if (production && v.adminCheckUserId !== null) {
      try {
        const member = await withRetry(() => api.getChatMember(v.chatId, v.adminCheckUserId!));
        if (member.status === "creator" || member.status === "administrator") return;
      } catch (e) {
        errors.push(`getChatMember: ${messageOf(e)}`);
        record();
        return;
      }
    }

    deleteOk = true;
    for (let i = 0; i < v.messageIds.length; i += BATCH) {
      const batch = v.messageIds.slice(i, i + BATCH);
      try {
        await withRetry(() => api.deleteMessages(v.chatId, batch));
      } catch (e) {
        deleteOk = false;
        errors.push(`deleteMessages: ${messageOf(e)}`);
      }
    }

    if (production && v.action === "delete_ban") {
      try {
        await withRetry(() => (v.sender.type === "chat"
          ? api.banChatSenderChat(v.chatId, v.sender.id)
          : api.banChatMember(v.chatId, v.sender.id)));
        banOk = true;
      } catch (e) {
        banOk = false;
        errors.push(`ban: ${messageOf(e)}`);
      }
    }
    record();
  }

  return {
    enqueue(violation: Violation): void {
      const prev = tails.get(violation.chatId) ?? Promise.resolve();
      const next: Promise<void> = prev
        .then(() => process(violation))
        .catch((e) => console.error(`Error procesando acción en el chat ${violation.chatId}:`, e))
        .finally(() => { if (tails.get(violation.chatId) === next) tails.delete(violation.chatId); });
      tails.set(violation.chatId, next);
    },
    async drain(): Promise<void> {
      while (tails.size) await Promise.all([...tails.values()]);
    },
  };
}
