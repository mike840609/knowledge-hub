import { afterEach, expect, it, vi } from "vitest";
import { DocumentAutosave, type SavedRevision } from "@/lib/document-autosave";
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

it("waits three seconds after the most recent change", async () => {
  const { queue, write } = setup();
  queue.change({ ...original, markdown: "First" });
  await vi.advanceTimersByTimeAsync(2999);
  expect(write).not.toHaveBeenCalled();
  queue.change({ ...original, markdown: "Second" });
  await vi.advanceTimersByTimeAsync(2999);
  expect(write).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(write).toHaveBeenCalledWith({ ...original, markdown: "Second" }, "r1");
});
it("saves sustained typing at fifteen seconds and starts a new deadline", async () => {
  const { queue, write } = setup();
  for (let i = 0; i < 15; i++) {
    queue.change({ ...original, markdown: `Typing ${i}` });
    await vi.advanceTimersByTimeAsync(1000);
  }
  expect(write).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenLastCalledWith({ ...original, markdown: "Typing 14" }, "r1");
  for (let i = 15; i < 30; i++) {
    queue.change({ ...original, markdown: `Typing ${i}` });
    await vi.advanceTimersByTimeAsync(1000);
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
