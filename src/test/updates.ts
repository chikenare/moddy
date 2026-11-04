import type { Chat, Message, Update } from "grammy/types";

const BOT_ID = 999;
const DATE = 1_000_000;
const GROUP: Chat = { id: -100, type: "supergroup", title: "Grupo" };
const ANA = { id: 10, is_bot: false, first_name: "Ana" };

let nextId = 1;
const id = () => nextId++;

function message(overrides: Partial<Message>): Message {
  return { message_id: id(), date: DATE, chat: GROUP, from: ANA, text: "hola", ...overrides } as Message;
}

export function groupMessage(overrides: Partial<Message> = {}): Update {
  return { update_id: id(), message: message(overrides) as any };
}

export function editedGroupMessage(overrides: Partial<Message> = {}): Update {
  return { update_id: id(), edited_message: { ...message(overrides), edit_date: DATE + 1 } as any };
}

export function channelPost(overrides: Partial<Message> = {}): Update {
  const chat: Chat = { id: -1002, type: "channel", title: "Canal" };
  return { update_id: id(), channel_post: message({ chat, from: undefined, sender_chat: chat, ...overrides }) as any };
}

export function myChatMember(input: {
  chat?: Chat; status: "administrator" | "member" | "left" | "kicked"; canDelete?: boolean; canRestrict?: boolean;
}): Update {
  const user = { id: BOT_ID, is_bot: true, first_name: "Test", username: "test_bot" };
  const old = { status: "member", user };
  const next = input.status === "administrator"
    ? {
        status: "administrator", user, can_be_edited: false, is_anonymous: false,
        can_manage_chat: true, can_delete_messages: input.canDelete ?? false,
        can_manage_video_chats: false, can_restrict_members: input.canRestrict ?? false,
        can_promote_members: false, can_change_info: false, can_invite_users: false,
      }
    : { status: input.status, user, ...(input.status === "kicked" ? { until_date: 0 } : {}),};
  return {
    update_id: id(),
    my_chat_member: { chat: input.chat ?? GROUP, from: ANA, date: DATE, old_chat_member: old, new_chat_member: next },
  } as Update;
}
