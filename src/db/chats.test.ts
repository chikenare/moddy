import { beforeEach, expect, test } from "vitest";
import { type Db, openDatabase } from "./connection.js";
import { deleteChat, getChat, insertChat, listChats, migrateChatId, updateChatInfo, updateChatSettings } from "./chats.js";
import { insertEvent, listEvents } from "./events.js";
import { addWhitelistEntry, listWhitelist, listWords, removeWord } from "./lists.js";

let db: Db;
const chatA = { id: -100, type: "supergroup" as const, title: "A", username: null };
const chatB = { id: -200, type: "group" as const, title: "B", username: "b" };

beforeEach(() => {
  db = openDatabase(":memory:");
});

const ev = () => ({
  chatId: -100, senderType: "user" as const, senderId: 1, senderName: "x", filter: "link" as const,
  matched: "m", text: "t", action: "delete" as const, deleteOk: true, banOk: null, error: null, dryRun: false,
});

test("un chat nuevo llega apagado, con filtros activos y semillas propias", () => {
  const c = insertChat(db, chatA, ["hola"]);
  expect(c).toMatchObject({ moderationEnabled: false, linkFilterEnabled: true, linkFilterAction: "delete_ban", floodCount: 5, floodSeconds: 10, botFilterEnabled: true });
  insertChat(db, chatB, ["hola"]);
  removeWord(db, chatA.id, "hola");
  expect(listWords(db, chatB.id)).toEqual(["hola"]);
  expect(listChats(db).map((x) => x.id)).toEqual([-100, -200]);
});

test("updateChatInfo actualiza solo los campos dados", () => {
  insertChat(db, chatA, []);
  updateChatInfo(db, chatA.id, { title: "Nuevo", canDelete: true, linkedChatId: 7 });
  expect(getChat(db, chatA.id)).toMatchObject({ title: "Nuevo", canDelete: true, canRestrict: false, linkedChatId: 7, type: "supergroup" });
});

test("updateChatSettings es parcial y devuelve undefined si no existe", () => {
  insertChat(db, chatA, []);
  const c = updateChatSettings(db, chatA.id, { floodCount: 9 });
  expect(c).toMatchObject({ floodCount: 9, floodSeconds: 10, title: "A" });
  expect(updateChatSettings(db, 1, { floodCount: 9 })).toBeUndefined();
});

test("migrateChatId conserva configuración, palabras, lista blanca y eventos", () => {
  insertChat(db, chatA, ["hola"]);
  updateChatSettings(db, chatA.id, { moderationEnabled: true });
  addWhitelistEntry(db, chatA.id, "ok.com");
  insertEvent(db, ev());
  migrateChatId(db, -100, -1001);
  expect(getChat(db, -100)).toBeUndefined();
  expect(getChat(db, -1001)?.moderationEnabled).toBe(true);
  expect(listWords(db, -1001)).toEqual(["hola"]);
  expect(listWhitelist(db, -1001)).toEqual(["ok.com"]);
  expect(listEvents(db, -1001, { limit: 10 })).toHaveLength(1);
});

test("migrateChatId reemplaza la fila recién creada del destino", () => {
  insertChat(db, { ...chatA, id: -1 }, ["vieja"]);
  updateChatSettings(db, -1, { moderationEnabled: true });
  insertChat(db, { ...chatA, id: -1001 }, ["nueva"]);
  migrateChatId(db, -1, -1001);
  expect(getChat(db, -1001)?.moderationEnabled).toBe(true);
  expect(listWords(db, -1001)).toEqual(["vieja"]);
});

test("migrateChatId no hace nada si el origen no existe", () => {
  insertChat(db, chatB, ["x"]);
  migrateChatId(db, -999, -200);
  expect(getChat(db, -200)).toMatchObject({ title: "B" });
  expect(listWords(db, -200)).toEqual(["x"]);
});

test("deleteChat borra en cascada", () => {
  insertChat(db, chatA, ["hola"]);
  addWhitelistEntry(db, chatA.id, "ok.com");
  insertEvent(db, ev());
  deleteChat(db, chatA.id);
  expect(getChat(db, chatA.id)).toBeUndefined();
  expect(listWords(db, chatA.id)).toEqual([]);
  expect(listWhitelist(db, chatA.id)).toEqual([]);
  expect(listEvents(db, chatA.id, { limit: 10 })).toEqual([]);
});
