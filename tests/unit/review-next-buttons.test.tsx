// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReviewNextButtons, nextReviewThreadId, type ReviewFilter } from "@/components/knowledge/review-thread-list";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function thread(id: string, block: number, status: "OPEN" | "RESOLVED" = "OPEN", outdated = false) {
  const anchor = { schemaVersion: 1 as const, blockPath: [block], blockKind: "paragraph" as const, startUtf16: 0, endUtf16: 1, exact: "x", prefix: "", suffix: "" };
  return {
    id, status, createdAt: new Date(0), updatedAt: new Date(0),
    currentAnchor: outdated ? { match: "OUTDATED" as const } : { match: "MATCHED" as const, anchor },
    comments: [],
  };
}

// Listed out of passage order: the order a reader meets them is the document's, not the list's.
const threads = [thread("c", 2), thread("a", 0), thread("gone", 0, "OPEN", true), thread("b", 1, "RESOLVED")];
const all = () => true;

test("goes to the next discussion in passage order, outdated ones last, and round again", () => {
  expect(nextReviewThreadId(threads, undefined, all)).toBe("a");
  expect(nextReviewThreadId(threads, "a", all)).toBe("b");
  expect(nextReviewThreadId(threads, "c", all)).toBe("gone");
  expect(nextReviewThreadId(threads, "gone", all)).toBe("a");
});

test("skips what does not match, and never offers the active discussion itself", () => {
  const open = (id: string) => threads.find(item => item.id === id)!.status === "OPEN";
  expect(nextReviewThreadId(threads, "a", open)).toBe("c");
  expect(nextReviewThreadId(threads, "a", id => id === "a")).toBeUndefined();
  expect(nextReviewThreadId([], undefined, all)).toBeUndefined();
});

test("an active id no longer listed starts from the first passage", () => {
  expect(nextReviewThreadId(threads, "deleted", all)).toBe("a");
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

function render(props: { activeThreadId?: string; filter?: ReviewFilter; unreadThreadIds?: ReadonlySet<string>; list?: ReturnType<typeof thread>[] }) {
  const onActivate = vi.fn(), onFilterChange = vi.fn();
  act(() => root.render(<ReviewNextButtons threads={props.list ?? threads} activeThreadId={props.activeThreadId} filter={props.filter ?? "ALL"} onActivate={onActivate} onFilterChange={onFilterChange} unreadThreadIds={props.unreadThreadIds} />));
  const button = (name: string) => Array.from(host.querySelectorAll("button")).find(item => item.textContent === name) ?? null;
  return { onActivate, onFilterChange, button };
}

test("Next open activates the next open discussion and leaves a filter that shows it", () => {
  const { button, onActivate, onFilterChange } = render({ activeThreadId: "a", filter: "OPEN" });
  act(() => button("Next open")!.click());
  expect(onActivate).toHaveBeenCalledWith("c");
  expect(onFilterChange).not.toHaveBeenCalled();
});

test("Next unread shows a discussion the filter hides by listing everything", () => {
  const { button, onActivate, onFilterChange } = render({ activeThreadId: "a", filter: "OPEN", unreadThreadIds: new Set(["b"]) });
  act(() => button("Next unread")!.click());
  expect(onActivate).toHaveBeenCalledWith("b");
  expect(onFilterChange).toHaveBeenCalledWith("ALL");
});

test("Next unread is disabled without unread discussions, and absent for a reader who has none to know", () => {
  expect(render({ unreadThreadIds: new Set() }).button("Next unread")!.disabled).toBe(true);
  expect(render({}).button("Next unread")).toBeNull();
});

test("Next open is disabled when the only open discussion is the one being read, or none is open", () => {
  expect(render({ list: [thread("a", 0), thread("b", 1, "RESOLVED")], activeThreadId: "a" }).button("Next open")!.disabled).toBe(true);
  expect(render({ list: [thread("b", 1, "RESOLVED")] }).button("Next open")!.disabled).toBe(true);
  expect(render({ list: [thread("a", 0), thread("b", 1, "RESOLVED")] }).button("Next open")!.disabled).toBe(false);
});
