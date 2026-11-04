import type { Db } from "../db/connection.js";
import { type StatField, type StatTotals, addDailyStats, utcDay } from "../db/stats.js";

export interface StatsSink {
  add(chatId: number, field: StatField, n?: number): void;
}

const FLUSH_MS = 30_000;

// Counts in memory and writes in batches. A failure here must never reach moderation: errors are only logged.
export function createStatsCollector(deps: { db: Db; now?: () => number; flushMs?: number }) {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const pending = new Map<string, { chatId: number; day: string; counts: Partial<StatTotals> }>();
  const enabled = db.prepare("SELECT moderation_enabled AS m, auto_replies_enabled AS a FROM chats WHERE id = ?");
  let timer: NodeJS.Timeout | undefined;

  function flush(): void {
    if (!pending.size) return;
    const rows = [...pending.values()];
    try {
      addDailyStats(db, rows);
      for (const r of rows) pending.delete(`${r.chatId}|${r.day}`);
    } catch (e) {
      console.error("Could not save statistics, will retry:", e);
    }
  }

  return {
    add(chatId: number, field: StatField, n = 1): void {
      try {
        // Broadcasts are sent on purpose by the owner, so they count in any chat.
        if (field !== "broadcasts") {
          const row = enabled.get(chatId) as { m: number; a: number } | undefined;
          if (!row || (row.m !== 1 && row.a !== 1)) return;
        }
        const day = utcDay(now());
        const key = `${chatId}|${day}`;
        const entry = pending.get(key) ?? { chatId, day, counts: {} };
        entry.counts[field] = (entry.counts[field] ?? 0) + n;
        pending.set(key, entry);
      } catch (e) {
        console.error("Could not count a statistic:", e);
      }
    },
    flush,
    start(): void {
      timer = setInterval(flush, deps.flushMs ?? FLUSH_MS);
      timer.unref();
    },
    stop(): void {
      clearInterval(timer);
      flush();
    },
  };
}
