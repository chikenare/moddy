import type { Message } from "grammy/types";

export type LinkSource = Pick<Message, "text" | "caption" | "entities" | "caption_entities" | "reply_markup">;

type Entity = NonNullable<Message["entities"]>[number];

function fromEntities(text: string | undefined, entities: Entity[] | undefined): string[] {
  const links: string[] = [];
  for (const entity of entities ?? []) {
    if (entity.type === "text_link") links.push(entity.url);
    else if (entity.type === "url" && text) links.push(text.slice(entity.offset, entity.offset + entity.length));
  }
  return links;
}

export function extractLinks(message: LinkSource): string[] {
  const links = [
    ...fromEntities(message.text, message.entities),
    ...fromEntities(message.caption, message.caption_entities),
  ];
  for (const row of message.reply_markup?.inline_keyboard ?? []) {
    for (const button of row) if ("url" in button && button.url) links.push(button.url);
  }
  return links;
}

interface Target {
  host: string;
  path: string;
}

function parseTarget(raw: string): (Target & { protocol: string }) | null {
  const value = raw.trim();
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!host) return null;
    const path = url.pathname.toLowerCase().replace(/\/+$/, "");
    return { protocol: url.protocol, host, path };
  } catch {
    return null;
  }
}

export function normalizeWhitelistEntry(raw: string): string | null {
  const target = parseTarget(raw);
  if (!target || (target.protocol !== "http:" && target.protocol !== "https:")) return null;
  const host = target.host.replace(/^www\./, "");
  if (!host.includes(".")) return null;
  return host + target.path;
}

function matches(link: Target, entry: string): boolean {
  const slash = entry.indexOf("/");
  const host = slash === -1 ? entry : entry.slice(0, slash);
  const path = slash === -1 ? "" : entry.slice(slash).toLowerCase().replace(/\/+$/, "");
  if (link.host !== host && !link.host.endsWith(`.${host}`)) return false;
  return path === "" || link.path === path || link.path.startsWith(`${path}/`);
}

export function findUnauthorizedLink(links: string[], whitelist: string[]): string | undefined {
  return links.find((link) => {
    const target = parseTarget(link);
    return !target || !whitelist.some((entry) => matches(target, entry));
  });
}
