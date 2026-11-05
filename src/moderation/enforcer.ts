import type { Api } from "grammy";
import type { Db } from "../db/connection.js";
import { type FilterAction, updateChatInfo } from "../db/chats.js";
import { type FilterName, insertEvent } from "../db/events.js";
import type { AppEnv } from "../env.js";
import { type NoticeOutcome, renderNotice } from "./notice.js";
import { withRetry as retrying } from "./retry.js";
import type { StatsSink } from "../metrics/collector.js";
import type { Sender } from "./sender.js";

export interface Violation {
  chatId: number; sender: Sender; filter: FilterName; matched: string;
  text: string | null; action: FilterAction; messageIds: number[];
  adminCheckUserId: number | null; noticeTemplate: string | null;
}
export type EnforcerApi = Pick<Api, "getChat" | "getChatMember" | "deleteMessages" | "banChatMember" | "banChatSenderChat" | "sendMessage">;

const BATCH = 100;
const NOTICE_INTERVAL_MS = 10_000;
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createEnforcer(deps: {
  api: EnforcerApi; db: Db; appEnv: AppEnv;
  sleep?: (ms: number) => Promise<void>; now?: () => number; stats?: StatsSink;
}) {
  const { api, db, appEnv, stats } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const tails = new Map<number, Promise<void>>();
  const lastNotice = new Map<number, number>();

  // No retry: waiting out a 429 here would delay moderation in this chat.
  async function sendNotice(v: Violation, template: string, outcome: NoticeOutcome): Promise<void> {
    const at = now();
    const last = lastNotice.get(v.chatId);
    if (last !== undefined && at - last < NOTICE_INTERVAL_MS) return;
    lastNotice.set(v.chatId, at);
    try {
      await api.sendMessage(v.chatId, renderNotice(template, { sender: v.sender, filter: v.filter, outcome }), {
        disable_notification: true,
        link_preview_options: { is_disabled: true },
      });
    } catch (e) {
      console.error(`Could not send the notice to chat ${v.chatId}:`, e);
    }
  }

  const withRetry = <T>(call: () => Promise<T>) => retrying(call, sleep);

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
        console.error(`Could not record the event for chat ${v.chatId}:`, e);
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

    if (v.sender.type === "chat") {
      try {
        const info = await withRetry(() => api.getChat(v.chatId));
        if ("linked_chat_id" in info && info.linked_chat_id === v.sender.id) {
          updateChatInfo(db, v.chatId, { linkedChatId: v.sender.id });
          return;
        }
      } catch (e) {
        errors.push(`getChat: ${messageOf(e)}`);
        record();
        return;
      }
    }

    // A hit counts even when the ban is simulated; only exempt admins and failed lookups return above.
    stats?.add(v.chatId, `${v.filter}_hits`);
    deleteOk = true;
    for (let i = 0; i < v.messageIds.length; i += BATCH) {
      const batch = v.messageIds.slice(i, i + BATCH);
      try {
        await withRetry(() => api.deleteMessages(v.chatId, batch));
        stats?.add(v.chatId, "deleted", batch.length);
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
        stats?.add(v.chatId, "banned");
      } catch (e) {
        banOk = false;
        errors.push(`ban: ${messageOf(e)}`);
      }
    }
    record();

    if (v.noticeTemplate !== null && (deleteOk || banOk)) {
      const simulated = !production && v.action === "delete_ban";
      const outcome: NoticeOutcome = banOk ? "banned" : simulated ? "simulated" : "warned";
      await sendNotice(v, v.noticeTemplate, outcome);
    }
  }

  // One at a time per chat, without holding up updates from other chats.
  function run(chatId: number, task: () => Promise<void>): void {
    const prev = tails.get(chatId) ?? Promise.resolve();
    const next: Promise<void> = prev
      .then(task)
      .catch((e) => console.error(`Failed to process action in chat ${chatId}:`, e))
      .finally(() => { if (tails.get(chatId) === next) tails.delete(chatId); });
    tails.set(chatId, next);
  }

  return {
    run,
    enqueue(violation: Violation): void {
      run(violation.chatId, () => process(violation));
    },
    async drain(): Promise<void> {
      while (tails.size) await Promise.all([...tails.values()]);
    },
  };
}
