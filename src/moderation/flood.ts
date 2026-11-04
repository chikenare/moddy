import type { Message } from "grammy/types";
import { normalizeText } from "./normalize.js";

export interface Fingerprint {
  kind: "text" | "media";
  value: string;
}

export interface FloodLimits {
  count: number;
  seconds: number;
}

interface Entry {
  messageId: number;
  date: number;
  fingerprint: Fingerprint;
}

const MAX_ENTRIES_PER_KEY = 100;
const SIMILAR_MIN_LENGTH = 20;
const SIMILARITY_THRESHOLD = 0.85;
const IDLE_SECONDS = 3600;
const SWEEP_INTERVAL_SECONDS = 600;

export function fingerprintOf(message: Message): Fingerprint | undefined {
  const mediaId =
    message.photo?.at(-1)?.file_unique_id ??
    message.sticker?.file_unique_id ??
    message.video?.file_unique_id ??
    message.animation?.file_unique_id ??
    message.document?.file_unique_id ??
    message.audio?.file_unique_id ??
    message.voice?.file_unique_id ??
    message.video_note?.file_unique_id;
  if (mediaId) return { kind: "media", value: mediaId };

  const raw = message.text ?? message.caption;
  if (raw === undefined) return undefined;
  const value = normalizeText(raw);
  return value.length > 0 ? { kind: "text", value } : undefined;
}

function bigrams(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i++) {
    const pair = text.slice(i, i + 2);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return counts;
}

function dice(a: string, b: string): number {
  const left = bigrams(a);
  const right = bigrams(b);
  let shared = 0;
  for (const [pair, n] of left) shared += Math.min(n, right.get(pair) ?? 0);
  return (2 * shared) / (a.length - 1 + (b.length - 1));
}

function similar(a: Fingerprint, b: Fingerprint): boolean {
  if (a.kind !== b.kind) return false;
  if (a.value === b.value) return true;
  if (a.kind === "media") return false;
  if (a.value.length < SIMILAR_MIN_LENGTH || b.value.length < SIMILAR_MIN_LENGTH) return false;
  return dice(a.value, b.value) >= SIMILARITY_THRESHOLD;
}

export class FloodTracker {
  private readonly windows = new Map<string, Entry[]>();
  private lastSweep: number | undefined;

  record(key: string, entry: Entry, limits: FloodLimits): number[] | null {
    this.sweep(entry.date);

    const cutoff = entry.date - limits.seconds;
    const window = (this.windows.get(key) ?? []).filter((e) => e.date > cutoff);
    window.push(entry);
    if (window.length > MAX_ENTRIES_PER_KEY) window.splice(0, window.length - MAX_ENTRIES_PER_KEY);

    const matching = window.filter((e) => similar(e.fingerprint, entry.fingerprint));
    if (matching.length >= limits.count) {
      this.windows.delete(key);
      return matching.map((e) => e.messageId);
    }
    this.windows.set(key, window);
    return null;
  }

  get size(): number {
    return this.windows.size;
  }

  private sweep(now: number): void {
    if (this.lastSweep === undefined) {
      this.lastSweep = now;
      return;
    }
    if (now - this.lastSweep < SWEEP_INTERVAL_SECONDS) return;
    this.lastSweep = now;
    for (const [key, window] of this.windows) {
      const last = window.at(-1);
      if (!last || last.date < now - IDLE_SECONDS) this.windows.delete(key);
    }
  }
}
