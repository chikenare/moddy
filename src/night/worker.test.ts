import { beforeEach, expect, test, vi } from "vitest";
import { insertChat, updateChatInfo } from "../db/chats.js";
import { type Db, openDatabase } from "../db/connection.js";
import { type NightModeSettings, getNightMode, saveNightModeSettings, saveNightPermissions, setNightOverride } from "../db/night-mode.js";
import { scheduledState } from "./schedule.js";
import { type NightApi, closedPermissions, createNightMode } from "./worker.js";

const CHAT = -100;
const at = (iso: string) => Date.parse(iso) / 1000;
const DAY = at("2026-11-04T12:00:00Z");
const NIGHT = at("2026-11-04T23:30:00Z");
const MORNING = at("2026-11-05T07:00:00Z");
const NEXT_NIGHT = at("2026-11-05T23:00:00Z");
const GROUP_PERMISSIONS = { can_send_messages: true, can_send_photos: true, can_invite_users: true, can_pin_messages: false };

const SETTINGS: NightModeSettings = {
  enabled: true, closeTime: "23:00", openTime: "07:00", timezone: "UTC", days: [0, 1, 2, 3, 4, 5, 6],
  closeNotice: { enabled: true, text: "Closed for the night", entities: [{ type: "bold", offset: 0, length: 6 }] },
  openNotice: { enabled: true, text: "Good morning", entities: [] },
  deleteCloseNotice: true,
};

let db: Db;
let clock: number;

beforeEach(() => {
  db = openDatabase(":memory:");
  insertChat(db, { id: CHAT, type: "supergroup", title: "Group", username: null }, []);
  clock = DAY;
});

function setup(overrides: Partial<Record<keyof NightApi, (...args: any[]) => Promise<unknown>>> = {}) {
  let nextMessage = 41;
  const api = {
    getChat: vi.fn(overrides.getChat ?? (async () => ({ id: CHAT, type: "supergroup", permissions: GROUP_PERMISSIONS }))),
    setChatPermissions: vi.fn(overrides.setChatPermissions ?? (async () => true)),
    sendMessage: vi.fn(overrides.sendMessage ?? (async () => ({ message_id: ++nextMessage }))),
    deleteMessage: vi.fn(overrides.deleteMessage ?? (async () => true)),
  };
  const worker = createNightMode({ api: api as unknown as NightApi, db, now: () => clock });
  return { api, worker };
}

const state = () => getNightMode(db, CHAT).state;

test("closes at the scheduled time: takes away sending, keeps the rest, and posts the notice", async () => {
  saveNightModeSettings(db, CHAT, SETTINGS);
  const { api, worker } = setup();
  await worker.tick();
  expect(api.setChatPermissions).not.toHaveBeenCalled();

  clock = NIGHT;
  await worker.tick();
  expect(api.setChatPermissions).toHaveBeenCalledWith(CHAT, closedPermissions(GROUP_PERMISSIONS), { use_independent_chat_permissions: true });
  expect(closedPermissions(GROUP_PERMISSIONS)).toMatchObject({ can_send_messages: false, can_send_photos: false, can_invite_users: true, can_pin_messages: false });
  expect(api.sendMessage).toHaveBeenCalledWith(CHAT, "Closed for the night", {
    link_preview_options: { is_disabled: true }, entities: [{ type: "bold", offset: 0, length: 6 }],
  });
  expect(state()).toBe("closed");

  await worker.tick();
  expect(api.setChatPermissions).toHaveBeenCalledTimes(1);
});

test("opens in the morning: restores the group's own permissions and swaps the notices", async () => {
  saveNightModeSettings(db, CHAT, SETTINGS);
  const { api, worker } = setup();
  clock = NIGHT;
  await worker.tick();
  clock = MORNING;
  await worker.tick();
  expect(api.setChatPermissions).toHaveBeenLastCalledWith(CHAT, GROUP_PERMISSIONS, { use_independent_chat_permissions: true });
  expect(api.deleteMessage).toHaveBeenCalledWith(CHAT, 42);
  expect(api.sendMessage).toHaveBeenLastCalledWith(CHAT, "Good morning", { link_preview_options: { is_disabled: true } });
  expect(getNightMode(db, CHAT)).toMatchObject({ state: "open", savedPermissions: null, closeMessageId: null });
});

test("a start in the middle of the night closes the group right away", async () => {
  saveNightModeSettings(db, CHAT, SETTINGS);
  clock = at("2026-11-05T03:00:00Z");
  const { api, worker } = setup();
  await worker.tick();
  expect(api.setChatPermissions).toHaveBeenCalledOnce();
  expect(state()).toBe("closed");
});

test("after a crash between saving and closing, the original permissions are kept", async () => {
  saveNightModeSettings(db, CHAT, SETTINGS);
  saveNightPermissions(db, CHAT, GROUP_PERMISSIONS);
  // Telegram already shows the closed permissions; reading them again would lose the originals.
  const { api, worker } = setup({ getChat: async () => ({ permissions: closedPermissions(GROUP_PERMISSIONS) }) });
  clock = NIGHT;
  await worker.tick();
  expect(api.getChat).not.toHaveBeenCalled();
  clock = MORNING;
  await worker.tick();
  expect(api.setChatPermissions).toHaveBeenLastCalledWith(CHAT, GROUP_PERMISSIONS, { use_independent_chat_permissions: true });
});

test("a failure is shown and retried after 5 minutes, not on every tick", async () => {
  saveNightModeSettings(db, CHAT, SETTINGS);
  let fail = true;
  const { api, worker } = setup({ setChatPermissions: async () => { if (fail) throw new Error("not enough rights"); return true; } });
  clock = NIGHT;
  await worker.tick();
  expect(getNightMode(db, CHAT)).toMatchObject({ state: "open", error: "not enough rights" });
  clock = NIGHT + 60;
  await worker.tick();
  expect(api.setChatPermissions).toHaveBeenCalledTimes(1);
  fail = false;
  clock = NIGHT + 5 * 60;
  await worker.tick();
  expect(getNightMode(db, CHAT)).toMatchObject({ state: "closed", error: null });
});

test("a notice that can't be posted does not stop the group from closing", async () => {
  saveNightModeSettings(db, CHAT, SETTINGS);
  const { worker } = setup({ sendMessage: async () => { throw new Error("blocked"); } });
  vi.spyOn(console, "error").mockImplementation(() => {});
  clock = NIGHT;
  await worker.tick();
  expect(getNightMode(db, CHAT)).toMatchObject({ state: "closed", closeMessageId: null, error: null });
});

test("closing by hand during the day holds until the night, then the morning opens it", async () => {
  saveNightModeSettings(db, CHAT, SETTINGS);
  const { api, worker } = setup();
  setNightOverride(db, CHAT, "closed", scheduledState(SETTINGS, DAY));
  await worker.tick();
  expect(state()).toBe("closed");
  clock = NIGHT;
  await worker.tick();
  expect(getNightMode(db, CHAT)).toMatchObject({ state: "closed", override: null });
  clock = MORNING;
  await worker.tick();
  expect(state()).toBe("open");
  expect(api.setChatPermissions).toHaveBeenCalledTimes(2);
});

test("opening by hand at night holds until the morning, and the next night closes again", async () => {
  saveNightModeSettings(db, CHAT, SETTINGS);
  const { worker } = setup();
  clock = NIGHT;
  await worker.tick();
  setNightOverride(db, CHAT, "open", scheduledState(SETTINGS, NIGHT));
  await worker.tick();
  expect(state()).toBe("open");
  clock = MORNING;
  await worker.tick();
  expect(getNightMode(db, CHAT).override).toBeNull();
  clock = NEXT_NIGHT;
  await worker.tick();
  expect(state()).toBe("closed");
});

test("closing by hand with no schedule stays closed until opened by hand", async () => {
  const { worker } = setup();
  setNightOverride(db, CHAT, "closed", "open");
  await worker.tick();
  clock = MORNING + 86_400;
  await worker.tick();
  expect(state()).toBe("closed");
  setNightOverride(db, CHAT, "open", "open");
  await worker.tick();
  expect(state()).toBe("open");
});

test("switching it off while closed opens the group", async () => {
  saveNightModeSettings(db, CHAT, SETTINGS);
  const { worker } = setup();
  clock = NIGHT;
  await worker.tick();
  saveNightModeSettings(db, CHAT, { ...SETTINGS, enabled: false });
  await worker.tick();
  expect(state()).toBe("open");
});

test("a group the bot left is not touched", async () => {
  saveNightModeSettings(db, CHAT, SETTINGS);
  updateChatInfo(db, CHAT, { botStatus: "kicked" });
  const { api, worker } = setup();
  clock = NIGHT;
  await worker.tick();
  expect(api.setChatPermissions).not.toHaveBeenCalled();
});
