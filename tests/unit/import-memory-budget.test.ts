import { describe, expect, it } from "vitest";
import { ImportMemoryBudget } from "@/modules/sources/application/import-memory-budget";

/** A job that records when it starts and finishes only when released. */
function job(log: string[], name: string) {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  return { work: async () => { log.push(`start ${name}`); await done; log.push(`end ${name}`); return name; }, finish };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the shared import memory budget", () => {
  it("runs imports that fit side by side", async () => {
    const budget = new ImportMemoryBudget(100);
    const log: string[] = [];
    const a = job(log, "a"), b = job(log, "b");
    const runs = [budget.run(40, a.work), budget.run(60, b.work)];
    await settle();
    expect(log).toEqual(["start a", "start b"]);
    a.finish(); b.finish();
    await expect(Promise.all(runs)).resolves.toEqual(["a", "b"]);
  });

  it("makes one that does not fit wait for room, then runs it", async () => {
    const budget = new ImportMemoryBudget(100);
    const log: string[] = [];
    const big = job(log, "big"), next = job(log, "next");
    const first = budget.run(80, big.work);
    const second = budget.run(50, next.work);
    await settle();
    expect(log).toEqual(["start big"]);
    big.finish();
    await first; await settle();
    expect(log).toEqual(["start big", "end big", "start next"]);
    next.finish();
    await expect(second).resolves.toBe("next");
  });

  it("admits in arrival order, so a waiting large import is not overtaken by small ones", async () => {
    const budget = new ImportMemoryBudget(100);
    const log: string[] = [];
    const running = job(log, "running"), large = job(log, "large"), small = job(log, "small");
    const runs = [budget.run(50, running.work), budget.run(100, large.work), budget.run(10, small.work)];
    await settle();
    expect(log).toEqual(["start running"]);
    running.finish(); await settle();
    expect(log).toEqual(["start running", "end running", "start large"]);
    large.finish(); await settle();
    expect(log.at(-1)).toBe("start small");
    small.finish();
    await Promise.all(runs);
  });

  it("still runs an import larger than the whole budget, alone", async () => {
    const budget = new ImportMemoryBudget(100);
    const log: string[] = [];
    const huge = job(log, "huge"), other = job(log, "other");
    const runs = [budget.run(500, huge.work), budget.run(1, other.work)];
    await settle();
    expect(log).toEqual(["start huge"]);
    huge.finish(); await settle();
    expect(log).toContain("start other");
    other.finish();
    await Promise.all(runs);
  });

  it("gives back a failed import's share and passes its error on", async () => {
    const budget = new ImportMemoryBudget(100);
    const failure = new Error("finalize failed");
    await expect(budget.run(100, async () => { throw failure; })).rejects.toBe(failure);
    await expect(budget.run(100, async () => "after")).resolves.toBe("after");
  });

  it("lets an empty import through even when the budget is full", async () => {
    const budget = new ImportMemoryBudget(100);
    const log: string[] = [];
    const full = job(log, "full");
    const running = budget.run(100, full.work);
    await settle();
    await expect(budget.run(0, async () => "empty")).resolves.toBe("empty");
    full.finish();
    await running;
  });
});
