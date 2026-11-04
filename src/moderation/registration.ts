import { Composer, type Context } from "grammy";
import type { Chat } from "grammy/types";
import type { Db } from "../db/connection.js";
import { type ChatInfo, type ChatType, getChat, insertChat, migrateChatId, updateChatInfo } from "../db/chats.js";
import { DEFAULT_WORDS } from "./default-words.js";

type GroupChat = Chat.GroupChat | Chat.SupergroupChat | Chat.ChannelChat;

const isGroupChat = (chat: Chat | undefined): chat is GroupChat =>
  chat !== undefined && chat.type !== "private";

export function createRegistrationHandler(deps: { db: Db }): Composer<Context> {
  const { db } = deps;
  const composer = new Composer<Context>();

  async function refresh(ctx: Context, id: number): Promise<void> {
    const update: ChatInfo = {};
    try {
      const info = await ctx.api.getChat(id);
      update.linkedChatId = "linked_chat_id" in info ? info.linked_chat_id ?? null : null;
      if (info.type !== "private") {
        update.type = info.type as ChatType;
        if ("title" in info && info.title !== undefined) update.title = info.title;
        update.username = "username" in info ? info.username ?? null : null;
      }
    } catch (error) {
      console.error(`No se pudo consultar getChat del chat ${id}`, error);
    }
    try {
      Object.assign(update, memberInfo(await ctx.api.getChatMember(id, ctx.me.id)));
    } catch (error) {
      console.error(`No se pudo consultar getChatMember del chat ${id}`, error);
    }
    if (Object.keys(update).length) updateChatInfo(db, id, update);
  }

  function ensure(ctx: Context, chat: GroupChat): void {
    if (getChat(db, chat.id)) return;
    insertChat(db, {
      id: chat.id, type: chat.type as ChatType, title: chat.title,
      username: "username" in chat ? chat.username ?? null : null,
    }, [...DEFAULT_WORDS]);
    void refresh(ctx, chat.id);
  }

  composer.use(async (ctx, next) => {
    const chat = ctx.chat;
    if (!isGroupChat(chat)) return next();

    const msg = ctx.msg;
    const migratedTo = msg?.migrate_to_chat_id;
    const migratedFrom = msg?.migrate_from_chat_id;

    if (migratedTo !== undefined) {
      migrateChatId(db, chat.id, migratedTo);
      void refresh(ctx, migratedTo);
      return next();
    }
    if (migratedFrom !== undefined) {
      migrateChatId(db, migratedFrom, chat.id);
      ensure(ctx, chat);
      void refresh(ctx, chat.id);
      return next();
    }

    const change = ctx.myChatMember;
    if (change) {
      const known = getChat(db, chat.id);
      if (change.new_chat_member.status === "left" || change.new_chat_member.status === "kicked") {
        if (known) updateChatInfo(db, chat.id, { botStatus: change.new_chat_member.status, canDelete: false, canRestrict: false });
        return next();
      }
      ensure(ctx, chat);
      updateChatInfo(db, chat.id, memberInfo(change.new_chat_member));
      if (known) void refresh(ctx, chat.id);
      return next();
    }

    if (msg?.left_chat_member?.id === ctx.me.id) return next();

    ensure(ctx, chat);
    if (msg?.new_chat_title !== undefined) updateChatInfo(db, chat.id, { title: msg.new_chat_title });
    return next();
  });

  return composer;
}

function memberInfo(member: { status: string; can_delete_messages?: boolean; can_restrict_members?: boolean }) {
  const owner = member.status === "creator";
  return {
    botStatus: member.status,
    canDelete: owner || member.can_delete_messages === true,
    canRestrict: owner || member.can_restrict_members === true,
  };
}
