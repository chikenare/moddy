import { GrammyError } from "grammy";
import { beforeEach, expect, test, vi } from "vitest";
import { insertChat } from "../db/chats.js";
import { type Db, openDatabase } from "../db/connection.js";
import { cancelMessage, createMessage, getMessage } from "../db/messages.js";
import { type SchedulerApi, createScheduler } from "./scheduler.js";

const NOW = 1_000_000;
let db: Db;
let clock: number;

beforeEach(() => {
  clock = NOW;
  db = openDatabase(":memory:");
  for (const id of [-1, -2]) insertChat(db, { id, type: "supergroup", title: `Chat ${id}`, username: null }, []);
});

function setup(send: (chatId: number, text: string) => Promise<unknown> = async () => ({ message_id: 1 })) {
  const sendMessage = vi.fn(send);
  const sleep = vi.fn(async () => {});
  const scheduler = createScheduler({ api: { sendMessage } as unknown as SchedulerApi, db, now: () => clock, sleep });
  return { sendMessage, sleep, scheduler };
}
const statuses = (id: number) => Object.fromEntries(getMessage(db, id)!.targets.map((t) => [t.chatId, t.status]));
const tooMany = () => new GrammyError("x", { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 3 } }, "sendMessage", {});

test("sends a due message to every chosen chat and records the time", async () => {
  const { sendMessage, scheduler } = setup();
  const m = createMessage(db, "Hello", [-1, -2], NOW);
  await scheduler.tick();
  expect(sendMessage).toHaveBeenCalledTimes(2);
  expect(sendMessage).toHaveBeenCalledWith(-1, "Hello", { link_preview_options: { is_disabled: true } });
  expect(statuses(m.id)).toEqual({ "-1": "sent", "-2": "sent" });
  expect(getMessage(db, m.id)!.targets[0]).toMatchObject({ sentAt: NOW, error: null });
});

test("a message in the future stays pending until its time", async () => {
  const { sendMessage, scheduler } = setup();
  const m = createMessage(db, "Later", [-1], NOW + 60);
  await scheduler.tick();
  expect(sendMessage).not.toHaveBeenCalled();
  expect(statuses(m.id)).toEqual({ "-1": "pending" });
  clock = NOW + 60;
  await scheduler.tick();
  expect(statuses(m.id)).toEqual({ "-1": "sent" });
});

test("a failure in one chat is recorded and does not stop the others", async () => {
  const { sendMessage, scheduler } = setup(async (chatId) => {
    if (chatId === -1) throw new Error("bot was kicked");
    return { message_id: 1 };
  });
  const m = createMessage(db, "Hello", [-1, -2], NOW);
  await scheduler.tick();
  expect(sendMessage).toHaveBeenCalledTimes(2);
  expect(statuses(m.id)).toEqual({ "-1": "failed", "-2": "sent" });
  expect(getMessage(db, m.id)!.targets.find((t) => t.chatId === -1)!.error).toBe("bot was kicked");
});

test("a 429 waits for retry_after and retries", async () => {
  let calls = 0;
  const { sendMessage, sleep, scheduler } = setup(async () => {
    if (++calls === 1) throw tooMany();
    return { message_id: 1 };
  });
  const m = createMessage(db, "Hello", [-1], NOW);
  await scheduler.tick();
  expect(sleep).toHaveBeenCalledWith(3000);
  expect(sendMessage).toHaveBeenCalledTimes(2);
  expect(statuses(m.id)).toEqual({ "-1": "sent" });
});

test("a 429 gives up after 3 attempts; other errors are not retried", async () => {
  const limited = setup(async () => { throw tooMany(); });
  const a = createMessage(db, "A", [-1], NOW);
  await limited.scheduler.tick();
  expect(limited.sendMessage).toHaveBeenCalledTimes(3);
  expect(statuses(a.id)).toEqual({ "-1": "failed" });

  const broken = setup(async () => { throw new Error("nope"); });
  const b = createMessage(db, "B", [-2], NOW);
  await broken.scheduler.tick();
  expect(broken.sendMessage).toHaveBeenCalledTimes(1);
  expect(statuses(b.id)).toEqual({ "-2": "failed" });
});

test("a message over an hour late is marked missed and never sent", async () => {
  const { sendMessage, scheduler } = setup();
  const late = createMessage(db, "Stale", [-1], NOW - 3601);
  const onTime = createMessage(db, "Fine", [-2], NOW - 3600);
  await scheduler.tick();
  expect(sendMessage).toHaveBeenCalledTimes(1);
  expect(sendMessage).toHaveBeenCalledWith(-2, "Fine", expect.anything());
  expect(statuses(late.id)).toEqual({ "-1": "missed" });
  expect(statuses(onTime.id)).toEqual({ "-2": "sent" });
});

test("a cancelled message is not sent", async () => {
  const { sendMessage, scheduler } = setup();
  const m = createMessage(db, "Hello", [-1, -2], NOW);
  expect(cancelMessage(db, m.id)).toBe(2);
  await scheduler.tick();
  expect(sendMessage).not.toHaveBeenCalled();
  expect(statuses(m.id)).toEqual({ "-1": "cancelled", "-2": "cancelled" });
});

test("cancelling during a run stops the targets not yet sent", async () => {
  let m = 0;
  const { sendMessage, scheduler } = setup(async () => {
    cancelMessage(db, m);
    return { message_id: 1 };
  });
  m = createMessage(db, "Hello", [-1, -2], NOW).id;
  await scheduler.tick();
  expect(sendMessage).toHaveBeenCalledTimes(1);
  const result = Object.values(statuses(m)).sort();
  expect(result).toEqual(["cancelled", "sent"]);
});

test("a target is marked as sending before the call, so a crash cannot send it twice", async () => {
  let m = 0;
  let during: unknown;
  const { scheduler } = setup(async () => {
    during = statuses(m);
    return { message_id: 1 };
  });
  m = createMessage(db, "Hello", [-1], NOW).id;
  await scheduler.tick();
  expect(during).toEqual({ "-1": "sending" });
});

test("start marks targets interrupted by a restart as failed and does not resend them", async () => {
  const first = setup(async () => new Promise(() => {}));
  const m = createMessage(db, "Hello", [-1], NOW);
  void first.scheduler.tick();
  await vi.waitFor(() => expect(statuses(m.id)).toEqual({ "-1": "sending" }));

  const second = setup();
  second.scheduler.start();
  await second.scheduler.stop();
  expect(second.sendMessage).not.toHaveBeenCalled();
  expect(statuses(m.id)).toEqual({ "-1": "failed" });
  expect(getMessage(db, m.id)!.targets[0]!.error).toMatch(/restart/i);
});

test("overlapping ticks never send twice", async () => {
  const { sendMessage, scheduler } = setup();
  createMessage(db, "Hello", [-1, -2], NOW);
  await Promise.all([scheduler.tick(), scheduler.tick(), scheduler.tick()]);
  expect(sendMessage).toHaveBeenCalledTimes(2);
});

test("a message queued during a run goes out in the same run", async () => {
  let queued = false;
  const { sendMessage, scheduler } = setup(async () => {
    if (!queued) {
      queued = true;
      createMessage(db, "Second", [-2], NOW);
      void scheduler.tick();
    }
    return { message_id: 1 };
  });
  createMessage(db, "First", [-1], NOW);
  await scheduler.tick();
  expect(sendMessage.mock.calls.map((c) => c[1])).toEqual(["First", "Second"]);
});

test("after stop, nothing more is sent", async () => {
  const { sendMessage, scheduler } = setup();
  await scheduler.stop();
  createMessage(db, "Hello", [-1], NOW);
  await scheduler.tick();
  expect(sendMessage).not.toHaveBeenCalled();
});

test("a database error during a run is logged and does not reject", async () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const { scheduler } = setup();
  createMessage(db, "Hello", [-1], NOW);
  db.close();
  await expect(scheduler.tick()).resolves.toBeUndefined();
  expect(spy).toHaveBeenCalled();
  spy.mockRestore();
});
