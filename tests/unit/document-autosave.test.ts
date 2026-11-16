import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentAutosave, KEEPALIVE_BYTES, type SavedRevision } from "@/lib/document-autosave";
const original = { title: "Title", markdown: "Original" };
function setup(write = vi.fn(async () => ({ revisionId: "r2", revisionNo: 2, changed: true }))) {
  vi.useFakeTimers();
  const saved = vi.fn();
  const queue = new DocumentAutosave(original, "r1", { write, saved, change: vi.fn() });
  return { queue, write, saved };
}
afterEach(() => vi.useRealTimers());
it("opening a document and reverting before debounce never write", async () => {
  const { queue, write } = setup();
  await vi.advanceTimersByTimeAsync(2000);
  queue.change({ ...original, markdown: "Changed" });
  queue.change(original);
  await vi.advanceTimersByTimeAsync(2000);
  expect(write).not.toHaveBeenCalled();
});
it("serializes slow writes, coalesces typing and advances the expected revision", async () => {
  let finish!: (value: SavedRevision) => void;
  const write = vi.fn().mockImplementationOnce(() => new Promise<SavedRevision>(resolve => { finish = resolve; }))
    .mockResolvedValue({ revisionId: "r3", revisionNo: 3, changed: true });
  const { queue } = setup(write);
  queue.change({ ...original, markdown: "First" });
  await vi.advanceTimersByTimeAsync(3000);
  queue.change({ ...original, markdown: "Second" });
  await vi.advanceTimersByTimeAsync(3000);
  queue.change({ ...original, markdown: "Latest" });
  expect(write).toHaveBeenCalledTimes(1);
  finish({ revisionId: "r2", revisionNo: 2, changed: true });
  await vi.advanceTimersByTimeAsync(3000);
  expect(write).toHaveBeenLastCalledWith({ ...original, markdown: "Latest" }, "r2");
  expect(queue.dirty).toBe(false);
});
it("saves a revert made while the earlier change is in flight", async () => {
  let finish!: (value: SavedRevision) => void;
  const write = vi.fn().mockImplementationOnce(() => new Promise<SavedRevision>(resolve => { finish = resolve; }))
    .mockResolvedValue({ revisionId: "r3", revisionNo: 3, changed: true });
  const { queue } = setup(write);
  queue.change({ ...original, markdown: "Changed" });
  await vi.advanceTimersByTimeAsync(3000);
  queue.change(original);
  finish({ revisionId: "r2", revisionNo: 2, changed: true });
  await vi.advanceTimersByTimeAsync(3000);
  expect(write).toHaveBeenLastCalledWith(original, "r2");
});
it("stops on a conflict instead of repeatedly submitting or losing text", async () => {
  const { queue, write } = setup(vi.fn().mockRejectedValue(new Error("conflict")));
  queue.change({ ...original, markdown: "Mine" });
  await vi.advanceTimersByTimeAsync(3000);
  queue.change({ ...original, markdown: "Still mine" });
  await vi.advanceTimersByTimeAsync(10000);
  expect(write).toHaveBeenCalledTimes(1);
  expect(queue.status).toBe("error");
  expect(queue.revisionId).toBe("r1");
  expect(queue.current.markdown).toBe("Still mine");
});
it("pauses during composition and resumes only afterwards", async () => {
  const { queue, write } = setup();
  queue.pause(true);
  queue.change({ ...original, markdown: "中文" });
  await vi.advanceTimersByTimeAsync(5000);
  expect(write).not.toHaveBeenCalled();
  queue.pause(false);
  await vi.advanceTimersByTimeAsync(3000);
  expect(write).toHaveBeenCalledTimes(1);
});
it("keeps the latest text on failure and retries explicitly", async () => {
  const write = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ revisionId: "r2", revisionNo: 2, changed: true });
  const { queue } = setup(write);
  queue.change({ ...original, markdown: "Mine" });
  await vi.advanceTimersByTimeAsync(3000);
  await queue.retry();
  expect(queue.status).toBe("saved");
  expect(queue.saved.markdown).toBe("Mine");
});
it("cancels pending writes on disposal", async () => {
  const { queue, write } = setup();
  queue.change({ ...original, markdown: "Mine" });
  queue.dispose();
  await vi.advanceTimersByTimeAsync(3000);
  expect(write).not.toHaveBeenCalled();
});

it("waits one second after the most recent change", async () => {
  const { queue, write } = setup();
  queue.change({ ...original, markdown: "First" });
  await vi.advanceTimersByTimeAsync(999);
  expect(write).not.toHaveBeenCalled();
  queue.change({ ...original, markdown: "Second" });
  await vi.advanceTimersByTimeAsync(999);
  expect(write).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(write).toHaveBeenCalledWith({ ...original, markdown: "Second" }, "r1");
});
it("saves sustained typing at five seconds and starts a new deadline", async () => {
  const { queue, write } = setup();
  for (let i = 0; i < 10; i++) {
    queue.change({ ...original, markdown: `Typing ${i}` });
    await vi.advanceTimersByTimeAsync(500);
  }
  expect(write).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenLastCalledWith({ ...original, markdown: "Typing 9" }, "r1");
  for (let i = 10; i < 20; i++) {
    queue.change({ ...original, markdown: `Typing ${i}` });
    await vi.advanceTimersByTimeAsync(500);
  }
  expect(write).toHaveBeenCalledTimes(2);
});
it("never submits mid-composition even when the maximum wait expires", async () => {
  const { queue, write } = setup();
  queue.pause(true);
  queue.change({ ...original, markdown: "組字" });
  await vi.advanceTimersByTimeAsync(16000);
  expect(write).not.toHaveBeenCalled();
  queue.pause(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(write).toHaveBeenCalledTimes(1);
});

it("adopts refreshed server content only while idle and keeps dirty input on its original baseline", () => {
  const { queue } = setup();
  const remote = { title: "Remote", markdown: "Remote content" };
  expect(queue.adopt(remote, "remote-r2")).toBe(true);
  expect(queue.current).toEqual(remote);
  expect(queue.revisionId).toBe("remote-r2");
  queue.change({ ...remote, markdown: "Local changes" });
  expect(queue.adopt(original, "remote-r3")).toBe(false);
  expect(queue.current.markdown).toBe("Local changes");
  expect(queue.revisionId).toBe("remote-r2");
});

it("explicit comment saving waits for a write already in flight and then saves newer text", async () => {
  let finish!: (revision: SavedRevision) => void;
  const write = vi.fn().mockImplementationOnce(() => new Promise<SavedRevision>(resolve => { finish = resolve; }))
    .mockResolvedValue({ revisionId: "r3", revisionNo: 3, changed: true });
  const { queue } = setup(write);
  queue.change({ ...original, markdown: "First" });
  const flight = queue.flush();
  queue.change({ ...original, markdown: "Second" });
  let settled = false;
  const waiting = queue.saveCurrent().then(revision => { settled = true; return revision; });
  await Promise.resolve();
  expect(settled).toBe(false);
  finish({ revisionId: "r2", revisionNo: 2, changed: true });
  await flight;
  expect(await waiting).toBe("r3");
  expect(write).toHaveBeenLastCalledWith({ ...original, markdown: "Second" }, "r2");
});
it("explicit comment saving rejects failure and cannot silently accept a paused dirty document", async () => {
  const failure = new Error("conflict");
  const { queue } = setup(vi.fn().mockRejectedValue(failure));
  queue.change({ ...original, markdown: "Edited" });
  queue.pause(true);
  await expect(queue.saveCurrent()).rejects.toThrow("Finish editing");
  queue.pause(false);
  await expect(queue.saveCurrent()).rejects.toBe(failure);
});

// Inline-editing spec, "Leaving and failures" (2026-11-16): a transient failure is tried again on
// its own, and what is unsaved when the editor goes is sent with a request that outlives the page.
describe("transient failures", () => {
  const transient = (error: unknown) => error instanceof TypeError;
  function retrying(write: ReturnType<typeof vi.fn>) {
    vi.useFakeTimers();
    const change = vi.fn();
    const queue = new DocumentAutosave(original, "r1", { write, saved: vi.fn(), change, retryable: transient });
    return { queue, change };
  }
  it("are tried again after 2s, then 4s, and saving goes on once one succeeds", async () => {
    const write = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue({ revisionId: "r2", revisionNo: 2, changed: true });
    const { queue } = retrying(write);
    queue.change({ ...original, markdown: "Mine" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(1);
    expect(queue.status).toBe("error");
    expect(queue.retrying).toBe(true);
    queue.change({ ...original, markdown: "Mine, more" });
    await vi.advanceTimersByTimeAsync(1999);
    expect(write).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(write).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3999);
    expect(write).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(write).toHaveBeenCalledTimes(3);
    expect(write).toHaveBeenLastCalledWith({ ...original, markdown: "Mine, more" }, "r1");
    expect(queue.status).toBe("saved");
    expect(queue.error).toBeUndefined();
    expect(queue.retrying).toBe(false);
  });
  it("wait at most 30s between tries", async () => {
    const write = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const { queue } = retrying(write);
    queue.change({ ...original, markdown: "Mine" });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000 + 4000 + 8000 + 16000);
    expect(write).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(write).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(write).toHaveBeenCalledTimes(6);
  });
  it("are tried again at once when asked (the connection came back)", async () => {
    const write = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue({ revisionId: "r2", revisionNo: 2, changed: true });
    const { queue } = retrying(write);
    queue.change({ ...original, markdown: "Mine" });
    await vi.advanceTimersByTimeAsync(1000);
    queue.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenCalledTimes(2);
    expect(queue.status).toBe("saved");
  });
  it("a failure that is not transient (a conflict) is not tried again, by timer or when asked", async () => {
    const write = vi.fn().mockRejectedValue(new Error("conflict"));
    const { queue } = retrying(write);
    queue.change({ ...original, markdown: "Mine" });
    await vi.advanceTimersByTimeAsync(1000);
    queue.retryNow();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(write).toHaveBeenCalledTimes(1);
    expect(queue.retrying).toBe(false);
    expect(queue.status).toBe("error");
  });
  it("stop being tried when the editor goes", async () => {
    const write = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const { queue } = retrying(write);
    queue.change({ ...original, markdown: "Mine" });
    await vi.advanceTimersByTimeAsync(1000);
    queue.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe("leaving", () => {
  it("sends what is unsaved at once, with a request that outlives the page", async () => {
    const { queue, write, saved } = setup();
    queue.change({ ...original, markdown: "Just typed" });
    expect(queue.canSendOnLeave()).toBe(true);
    queue.leave();
    expect(write).toHaveBeenCalledWith({ ...original, markdown: "Just typed" }, "r1", { keepalive: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(saved).toHaveBeenCalledTimes(1);
    queue.change({ ...original, markdown: "After leaving" });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(write).toHaveBeenCalledTimes(1);
  });
  it("sends the rest after a write already in flight", async () => {
    let finish!: (value: SavedRevision) => void;
    const write = vi.fn().mockImplementationOnce(() => new Promise<SavedRevision>(resolve => { finish = resolve; }))
      .mockResolvedValue({ revisionId: "r3", revisionNo: 3, changed: true });
    const { queue } = setup(write);
    queue.change({ ...original, markdown: "First" });
    void queue.flush();
    queue.change({ ...original, markdown: "Second" });
    queue.leave();
    expect(write).toHaveBeenCalledTimes(1);
    finish({ revisionId: "r2", revisionNo: 2, changed: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenLastCalledWith({ ...original, markdown: "Second" }, "r2", { keepalive: true });
  });
  it("sends nothing while paused (composing, recovering, no title) or failed, and says it cannot", async () => {
    const { queue, write } = setup();
    queue.change({ ...original, markdown: "組字" });
    queue.pause(true);
    expect(queue.canSendOnLeave()).toBe(false);
    queue.leave();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(write).not.toHaveBeenCalled();
  });
  it("cannot send more than a request that outlives the page may carry", () => {
    const { queue } = setup();
    queue.change({ ...original, markdown: "x".repeat(KEEPALIVE_BYTES) });
    expect(queue.canSendOnLeave()).toBe(false);
    queue.change({ ...original, markdown: "長".repeat(1000) });
    expect(queue.canSendOnLeave()).toBe(true);
  });
  it("sends a document too large for that request as a normal one", async () => {
    const { queue, write } = setup();
    queue.change({ ...original, markdown: "x".repeat(KEEPALIVE_BYTES) });
    void queue.flush({ keepalive: true });
    expect(write).toHaveBeenCalledWith({ ...original, markdown: "x".repeat(KEEPALIVE_BYTES) }, "r1");
  });
  it("has nothing to send when nothing changed", () => {
    const { queue, write } = setup();
    expect(queue.canSendOnLeave()).toBe(true);
    queue.leave();
    expect(write).not.toHaveBeenCalled();
  });
  it("sends now with that request when the page may go (pagehide), and keeps saving if it stays", async () => {
    const { queue, write } = setup();
    queue.change({ ...original, markdown: "Hidden" });
    void queue.flush({ keepalive: true });
    expect(write).toHaveBeenCalledWith({ ...original, markdown: "Hidden" }, "r1", { keepalive: true });
    await vi.advanceTimersByTimeAsync(0);
    queue.change({ ...original, markdown: "Back again" });
    await vi.advanceTimersByTimeAsync(3000);
    expect(write).toHaveBeenLastCalledWith({ ...original, markdown: "Back again" }, "r2");
  });
});

describe("rebasing after a merged conflict", () => {
  it("saves the merged text against the revision saved elsewhere", async () => {
    vi.useFakeTimers();
    const write = vi.fn().mockRejectedValueOnce(new Error("conflict")).mockResolvedValue({ revisionId: "r3", revisionNo: 3, changed: true });
    const queue = new DocumentAutosave(original, "r1", { write, saved: vi.fn(), change: vi.fn() });
    queue.change({ ...original, markdown: "Mine" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(queue.status).toBe("error");
    expect(queue.rebase({ ...original, markdown: "Theirs" }, "r2", { ...original, markdown: "Theirs and mine" })).toBe(true);
    expect(queue.error).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenLastCalledWith({ ...original, markdown: "Theirs and mine" }, "r2");
    expect(queue.status).toBe("saved");
    expect(queue.rebase({ ...original, markdown: "x" }, "r9", original)).toBe(false);
  });
});
