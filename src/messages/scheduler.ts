import { type Api, GrammyError } from "grammy";
import type { Db } from "../db/connection.js";
import { type DueTarget, claimTarget, dueTargets, failInterruptedTargets, finishTarget } from "../db/messages.js";

export type SchedulerApi = Pick<Api, "sendMessage">;

const TICK_MS = 15_000;
const GAP_MS = 50;
const ATTEMPTS = 3;
const MAX_LATE_SECONDS = 3600;
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createScheduler(deps: {
  api: SchedulerApi; db: Db;
  now?: () => number; sleep?: (ms: number) => Promise<void>;
}) {
  const { api, db } = deps;
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const sleep = deps.sleep ?? defaultSleep;
  let running: Promise<void> | null = null;
  let rerun = false;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  async function send(target: DueTarget): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await api.sendMessage(target.chatId, target.text, { link_preview_options: { is_disabled: true } });
        return;
      } catch (e) {
        if (!(e instanceof GrammyError) || e.error_code !== 429 || attempt >= ATTEMPTS) throw e;
        await sleep((e.parameters.retry_after ?? 1) * 1000);
      }
    }
  }

  async function deliver(target: DueTarget): Promise<void> {
    if (now() - target.sendAt > MAX_LATE_SECONDS) {
      claimTarget(db, target.messageId, target.chatId, "missed");
      return;
    }
    // Claimed before sending: after a crash the target is reported as failed instead of sent twice.
    if (!claimTarget(db, target.messageId, target.chatId, "sending")) return;
    try {
      await send(target);
      finishTarget(db, target.messageId, target.chatId, { sentAt: now() });
    } catch (e) {
      finishTarget(db, target.messageId, target.chatId, { error: e instanceof Error ? e.message : String(e) });
    }
    await sleep(GAP_MS);
  }

  async function run(): Promise<void> {
    do {
      rerun = false;
      for (const target of dueTargets(db, now())) {
        if (stopped) return;
        await deliver(target);
      }
    } while (rerun && !stopped);
  }

  function tick(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (running) {
      rerun = true;
      return running;
    }
    running = run()
      .catch((e) => console.error("Scheduled messages run failed:", e))
      .finally(() => { running = null; });
    return running;
  }

  return {
    tick,
    kick(): void {
      void tick();
    },
    start(): void {
      failInterruptedTargets(db);
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
