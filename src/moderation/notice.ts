import type { FilterName } from "../db/events.js";

export type NoticeOutcome = "banned" | "simulated" | "warned";

const ACTIONS: Record<NoticeOutcome, string> = {
  banned: "banned",
  simulated: "banned (simulated)",
  warned: "warned",
};

const REASONS: Record<FilterName, string> = {
  link: "unauthorized link",
  word: "banned word",
  flood: "repeated messages",
  bot: "unauthorized bot",
};

const LINK_LIKE = /[@/]|\.\p{L}{2,}|\d\.\d/u;
const MAX_NAME = 40;

// Spammers use their display name as an ad: the bot must not repeat links in the group.
export function safeName(sender: { id: number; name: string }): string {
  const clean = sender.name
    .replace(/\p{C}/gu, (c) => (/\s/.test(c) ? " " : ""))
    .replace(/\s+/g, " ")
    .trim();
  if (!clean || LINK_LIKE.test(clean.normalize("NFKC"))) return String(sender.id);
  const chars = Array.from(clean);
  return chars.length > MAX_NAME ? `${chars.slice(0, MAX_NAME).join("")}…` : clean;
}

export function renderNotice(
  template: string,
  input: { sender: { id: number; name: string }; filter: FilterName; outcome: NoticeOutcome },
): string {
  const values: Record<string, string> = {
    user: safeName(input.sender),
    action: ACTIONS[input.outcome],
    reason: REASONS[input.filter],
  };
  return template.replace(/\{(user|action|reason)\}/g, (_, key: string) => values[key]!);
}
