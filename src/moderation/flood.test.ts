import type { Message } from "grammy/types";
import { expect, test } from "vitest";
import { type Fingerprint, FloodTracker, fingerprintOf } from "./flood.js";

const limits = { count: 5, seconds: 10 };

function msg(messageId: number, date: number, text: string) {
  return { messageId, date, fingerprint: textFp(text) };
}

function textFp(text: string): Fingerprint {
  const fp = fingerprintOf({ message_id: 1, date: 0, chat: { id: 1, type: "supergroup", title: "g" }, text } as Message);
  if (!fp) throw new Error("sin huella");
  return fp;
}

const base = { message_id: 1, date: 0, chat: { id: 1, type: "supergroup", title: "g" } };
const photoMessage = (id: string) =>
  ({
    ...base,
    photo: [
      { file_id: "s", file_unique_id: "small", width: 1, height: 1 },
      { file_id: "b", file_unique_id: id, width: 2, height: 2 },
    ],
  }) as Message;
const stickerMessage = (id: string) =>
  ({
    ...base,
    sticker: { file_id: "x", file_unique_id: id, type: "regular", width: 1, height: 1, is_animated: false, is_video: false },
  }) as Message;
const serviceMessage = () => ({ ...base, new_chat_title: "nuevo" }) as Message;

test("al quinto mensaje igual devuelve los cinco ids y limpia la ventana", () => {
  const t = new FloodTracker();
  for (let i = 1; i <= 4; i++) expect(t.record("k", msg(i, 100 + i, "hola"), limits)).toBeNull();
  expect(t.record("k", msg(5, 105, "HOLA"), limits)).toEqual([1, 2, 3, 4, 5]);
  expect(t.record("k", msg(6, 106, "hola"), limits)).toBeNull();
});

test("usa message.date: mensajes atrasados procesados juntos no son flood", () => {
  const t = new FloodTracker();
  for (let i = 0; i < 6; i++) expect(t.record("k", msg(i, i * 11, "hola"), limits)).toBeNull();
});

test("no mezcla remitentes ni textos distintos", () => {
  const t = new FloodTracker();
  for (let i = 1; i <= 4; i++) {
    expect(t.record(i % 2 ? "a" : "b", msg(i, 100 + i, "hola"), limits)).toBeNull();
  }
  expect(t.record("a", msg(5, 105, "hola"), limits)).toBeNull();
  const u = new FloodTracker();
  for (let i = 1; i <= 5; i++) expect(u.record("k", msg(i, 100 + i, `texto ${i}`), limits)).toBeNull();
});

test("textos largos casi iguales cuentan; textos cortos parecidos no", () => {
  const t = new FloodTracker();
  const frase = "oferta increíble de criptomonedas para ti";
  for (let i = 1; i <= 4; i++) expect(t.record("k", msg(i, 100 + i, frase), limits)).toBeNull();
  expect(t.record("k", msg(5, 105, `${frase} hoy`), limits)).toEqual([1, 2, 3, 4, 5]);

  const u = new FloodTracker();
  for (let i = 1; i <= 4; i++) expect(u.record("k", msg(i, 100 + i, "hola"), limits)).toBeNull();
  expect(u.record("k", msg(5, 105, "hole"), limits)).toBeNull();
});

test("la misma multimedia cuenta por file_unique_id", () => {
  expect(fingerprintOf(photoMessage("abc"))).toEqual({ kind: "media", value: "abc" });
  expect(fingerprintOf(stickerMessage("abc"))).toEqual({ kind: "media", value: "abc" });
  const t = new FloodTracker();
  const fp = fingerprintOf(photoMessage("abc")) as Fingerprint;
  for (let i = 1; i <= 4; i++) expect(t.record("k", { messageId: i, date: 100 + i, fingerprint: fp }, limits)).toBeNull();
  expect(t.record("k", { messageId: 5, date: 105, fingerprint: fp }, limits)).toEqual([1, 2, 3, 4, 5]);
});

test("la multimedia tiene prioridad sobre el pie de foto", () => {
  const m = { ...photoMessage("abc"), caption: "hola" } as Message;
  expect(fingerprintOf(m)).toEqual({ kind: "media", value: "abc" });
  expect(fingerprintOf({ ...base, caption: "HOLA" } as Message)).toEqual({ kind: "text", value: "hola" });
});

test("un mensaje de servicio no tiene huella", () => {
  expect(fingerprintOf(serviceMessage())).toBeUndefined();
});

test("olvida remitentes inactivos", () => {
  const t = new FloodTracker();
  t.record("viejo", msg(1, 0, "a"), limits);
  t.record("nuevo", msg(2, 4000, "a"), limits);
  expect(t.size).toBe(1);
});
