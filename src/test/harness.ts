import { Bot } from "grammy";

export interface ApiCall { method: string; payload: any }

export function createTestBot(): {
  bot: Bot; calls: ApiCall[];
  callsOf(method: string): ApiCall[];
  respond(method: string, fn: (payload: any) => unknown): void;
} {
  const bot = new Bot("1:test", {
    botInfo: {
      id: 999, is_bot: true, first_name: "Test", username: "test_bot",
      can_join_groups: true, can_read_all_group_messages: true, supports_inline_queries: false,
      can_connect_to_business: false, has_main_web_app: false,
      has_topics_enabled: false, allows_users_to_create_topics: false,
      can_manage_bots: false, supports_join_request_queries: false,
    },
  });
  const calls: ApiCall[] = [];
  const responders = new Map<string, (payload: any) => unknown>([
    ["getChat", (p) => ({ id: p?.chat_id, type: "supergroup", title: "Grupo" })],
    ["getChatMember", (p) => ({ status: "member", user: { id: p?.user_id, is_bot: false, first_name: "Ana" } })],
  ]);

  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    const fn = responders.get(method);
    return { ok: true, result: fn ? await fn(payload) : true } as any;
  });

  return {
    bot, calls,
    callsOf: (method) => calls.filter((c) => c.method === method),
    respond: (method, fn) => { responders.set(method, fn); },
  };
}
