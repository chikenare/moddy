import { hostOf } from "../moderation/links.js";
import type { Db } from "./connection.js";

export const STAT_FIELDS = [
  "messages", "joins", "leaves", "deleted", "banned",
  "link_hits", "word_hits", "flood_hits", "bot_hits", "auto_replies", "broadcasts",
] as const;
export type StatField = (typeof STAT_FIELDS)[number];
export type StatTotals = Record<StatField, number>;
export interface StatRow extends StatTotals { chatId: number; day: string }

export const PERIODS = [7, 30, 90] as const;
const RETENTION_DAYS = 400;
const TOP = 10;
const DAY_SECONDS = 86400;

export const emptyTotals = (): StatTotals => Object.fromEntries(STAT_FIELDS.map((f) => [f, 0])) as StatTotals;

export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const dayStartMs = (day: string): number => Date.parse(`${day}T00:00:00Z`);
const shiftDay = (day: string, by: number): string => utcDay(dayStartMs(day) + by * DAY_SECONDS * 1000);

// Adds to the stored counters. Rows of a chat that no longer exists are skipped instead of failing the batch.
export function addDailyStats(db: Db, rows: Array<{ chatId: number; day: string; counts: Partial<StatTotals> }>): void {
  const columns = STAT_FIELDS.join(", ");
  const insert = db.prepare(
    `INSERT INTO chat_daily_stats (chat_id, day, ${columns})
     SELECT ?, ?, ${STAT_FIELDS.map(() => "?").join(", ")} WHERE EXISTS (SELECT 1 FROM chats WHERE id = ?)
     ON CONFLICT (chat_id, day) DO UPDATE SET ${STAT_FIELDS.map((f) => `${f} = ${f} + excluded.${f}`).join(", ")}`,
  );
  db.transaction(() => {
    for (const r of rows) insert.run(r.chatId, r.day, ...STAT_FIELDS.map((f) => r.counts[f] ?? 0), r.chatId);
  })();
}

export function purgeStats(db: Db, nowMs: number): number {
  return db.prepare("DELETE FROM chat_daily_stats WHERE day < ?").run(shiftDay(utcDay(nowMs), -RETENTION_DAYS)).changes;
}

export interface Metrics {
  days: number; from: string; to: string;
  totals: StatTotals; previous: StatTotals;
  series: Array<{ day: string } & StatTotals>;
  topWords: Array<{ value: string; count: number }>;
  topDomains: Array<{ value: string; count: number }>;
  topChats: Array<{ id: number; title: string; messages: number; actions: number }>;
}

const sums = STAT_FIELDS.map((f) => `COALESCE(SUM(${f}), 0) AS ${f}`).join(", ");

export function getMetrics(db: Db, opts: { days: number; chatId?: number; nowMs: number }): Metrics {
  const { days, chatId } = opts;
  const to = utcDay(opts.nowMs);
  const from = shiftDay(to, -(days - 1));
  const previousFrom = shiftDay(from, -days);
  const scope = chatId === undefined ? "" : "AND chat_id = ?";
  const args = (...a: unknown[]) => (chatId === undefined ? a : [...a, chatId]);

  const total = (a: string, b: string) =>
    db.prepare(`SELECT ${sums} FROM chat_daily_stats WHERE day >= ? AND day <= ? ${scope}`).get(...args(a, b)) as StatTotals;
  const byDay = new Map(
    (db.prepare(`SELECT day, ${sums} FROM chat_daily_stats WHERE day >= ? AND day <= ? ${scope} GROUP BY day`)
      .all(...args(from, to)) as Array<{ day: string } & StatTotals>).map((r) => [r.day, r]),
  );
  const series = Array.from({ length: days }, (_, i) => {
    const day = shiftDay(from, i);
    return byDay.get(day) ?? { day, ...emptyTotals() };
  });

  const events = db.prepare(
    `SELECT filter, matched, COUNT(*) AS n FROM moderation_events
     WHERE created_at >= ? AND filter IN ('word', 'link') AND delete_ok IS NOT NULL ${scope}
     GROUP BY filter, matched`,
  ).all(...args(Math.floor(dayStartMs(from) / 1000))) as Array<{ filter: string; matched: string; n: number }>;
  const words = new Map<string, number>();
  const domains = new Map<string, number>();
  for (const e of events) {
    const [map, key] = e.filter === "word" ? [words, e.matched] : [domains, hostOf(e.matched)];
    if (key) map.set(key, (map.get(key) ?? 0) + e.n);
  }
  const top = (m: Map<string, number>) =>
    [...m].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)).slice(0, TOP);

  const topChats = chatId !== undefined ? [] : (db.prepare(
    `SELECT c.id, c.title, SUM(s.messages) AS messages,
            SUM(s.link_hits + s.word_hits + s.flood_hits + s.bot_hits) AS actions
     FROM chat_daily_stats s JOIN chats c ON c.id = s.chat_id
     WHERE s.day >= ? AND s.day <= ? GROUP BY c.id
     HAVING SUM(s.messages) + SUM(s.link_hits + s.word_hits + s.flood_hits + s.bot_hits) > 0
     ORDER BY messages DESC, actions DESC, c.id LIMIT 5`,
  ).all(from, to) as Metrics["topChats"]);

  return {
    days, from, to,
    totals: total(from, to), previous: total(previousFrom, shiftDay(from, -1)),
    series, topWords: top(words), topDomains: top(domains), topChats,
  };
}
