import type { Api } from "grammy";
import type { ChatPermissions, MessageEntity } from "grammy/types";
import type { Db } from "../db/connection.js";
import {
  type NightMode, type NightNotice, clearNightOverride, listNightModesToCheck, markNightClosed, markNightOpen,
  recordNightError, saveNightPermissions,
} from "../db/night-mode.js";
import { desiredState } from "./schedule.js";

export type NightApi = Pick<Api, "getChat" | "setChatPermissions" | "sendMessage" | "deleteMessage">;

const TICK_MS = 30_000;
const RETRY_SECONDS = 5 * 60;

const SEND_PERMISSIONS = [
  "can_send_messages", "can_send_audios", "can_send_documents", "can_send_photos", "can_send_videos",
  "can_send_video_notes", "can_send_voice_notes", "can_send_polls", "can_send_other_messages", "can_add_web_page_previews",
] as const;

// Only sending is taken away; inviting, pinning and the rest stay as the group had them.
export function closedPermissions(saved: ChatPermissions): ChatPermissions {
  return { ...saved, ...Object.fromEntries(SEND_PERMISSIONS.map((p) => [p, false])) };
}

// Only if the saved permissions were lost: members may write again, nothing more.
const FALLBACK_OPEN: ChatPermissions = Object.fromEntries(SEND_PERMISSIONS.map((p) => [p, true]));

export function createNightMode(deps: { api: NightApi; db: Db; now?: () => number }) {
  const { api, db } = deps;
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  let running: Promise<void> | null = null;
  let rerun = false;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  // A notice that fails must not undo the close or open itself.
  async function notify(chatId: number, notice: NightNotice): Promise<number | null> {
    if (!notice.enabled || !notice.text) return null;
    try {
      const sent = await api.sendMessage(chatId, notice.text, {
        link_preview_options: { is_disabled: true },
        ...(notice.entities.length ? { entities: notice.entities as MessageEntity[] } : {}),
      });
      return sent.message_id;
    } catch (e) {
      console.error(`Could not post the night mode notice in ${chatId}:`, e);
      return null;
    }
  }

  async function close(n: NightMode): Promise<void> {
    let saved = n.savedPermissions;
    if (!saved) {
      saved = (await api.getChat(n.chatId)).permissions ?? FALLBACK_OPEN;
      saveNightPermissions(db, n.chatId, saved);
    }
    await api.setChatPermissions(n.chatId, closedPermissions(saved), { use_independent_chat_permissions: true });
    markNightClosed(db, n.chatId, await notify(n.chatId, n.closeNotice));
  }

  async function open(n: NightMode): Promise<void> {
    await api.setChatPermissions(n.chatId, n.savedPermissions ?? FALLBACK_OPEN, { use_independent_chat_permissions: true });
    if (n.deleteCloseNotice && n.closeMessageId !== null) {
      // An admin may have deleted it already, which is fine.
      await api.deleteMessage(n.chatId, n.closeMessageId).catch(() => {});
    }
    markNightOpen(db, n.chatId);
    await notify(n.chatId, n.openNotice);
  }

  async function check(n: NightMode): Promise<void> {
    const at = now();
    const { state, overrideDone } = desiredState(n, at);
    if (overrideDone) clearNightOverride(db, n.chatId);
    if (state === n.state || (n.retryAt !== null && n.retryAt > at)) return;
    try {
      await (state === "closed" ? close(n) : open(n));
    } catch (e) {
      recordNightError(db, n.chatId, e instanceof Error ? e.message : String(e), at + RETRY_SECONDS);
    }
  }

  async function run(): Promise<void> {
    do {
      rerun = false;
      for (const n of listNightModesToCheck(db)) {
        if (stopped) return;
        await check(n);
      }
    } while (rerun && !stopped);
  }

  /** Brings every group to the state its schedule asks for; the first run after a restart catches up. */
  function tick(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (running) {
      rerun = true;
      return running;
    }
    running = run()
      .catch((e) => console.error("Night mode run failed:", e))
      .finally(() => { running = null; });
    return running;
  }

  return {
    tick,
    start(): void {
      void tick();
      timer = setInterval(() => void tick(), TICK_MS);
      timer.unref();
    },
    async stop(): Promise<void> {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
