import { expect, test, vi } from "vitest";
import { runShutdown } from "./shutdown.js";

test("ejecuta los pasos en orden esperando a cada uno", async () => {
  const log: string[] = [];
  const slow = async () => { log.push("lento:inicio"); await new Promise((r) => setTimeout(r, 10)); log.push("lento:fin"); };
  await runShutdown([["a", slow], ["b", () => { log.push("b"); }]]);
  expect(log).toEqual(["lento:inicio", "lento:fin", "b"]);
});

test("un paso que falla se registra y no detiene los siguientes", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const later = vi.fn();
  await runShutdown([
    ["rechazado", () => Promise.reject(new Error("red caída"))],
    ["síncrono", () => { throw new Error("boom"); }],
    ["final", later],
  ]);
  expect(later).toHaveBeenCalledOnce();
  expect(error).toHaveBeenCalledTimes(2);
  expect(error.mock.calls[0]![0]).toContain("rechazado");
});
