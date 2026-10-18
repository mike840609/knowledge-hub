// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReviewThreadList } from "@/components/knowledge/review-thread-list";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const markdown = "Para zero.\n\nPara one.";
let host: HTMLDivElement;
let root: Root | null = null;

function anchor(blockPath: number[], exact: string) {
  return { schemaVersion: 1 as const, blockPath, blockKind: "paragraph" as const, startUtf16: 0, endUtf16: exact.length, exact, prefix: "", suffix: "" };
}

function thread(id: string, blockPath: number[], exact: string, body = `body of ${id}`) {
  return {
    id, status: "OPEN" as const, createdAt: new Date(0), updatedAt: new Date(0),
    currentAnchor: { match: "MATCHED" as const, anchor: anchor(blockPath, exact) },
    comments: [{ id: `${id}-c1`, threadId: id, authorName: "Ann", body, visibility: "VISIBLE" as const, createdAt: new Date(0), editedAt: null, deleted: false, own: false }],
  };
}

const props = { writesEnabled: true, filter: "ALL" as const, onFilterChange: () => {}, reply: async () => {}, railMarkdown: markdown, onActivate: () => {} };

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  vi.unstubAllGlobals();
});

function renderList(threads: ReturnType<typeof thread>[], extra?: Partial<typeof props & { activeThreadId?: string }>) {
  act(() => {
    root = createRoot(host);
    root.render(createElement(ReviewThreadList, { threads: threads as never, ...props, ...extra }));
  });
  return host;
}

function cards() {
  return Array.from(host.querySelectorAll<HTMLElement>("[data-review-thread]"));
}

test("a passage with three threads reads as one summary until expanded", () => {
  renderList([thread("t0", [0], "Para zero."), thread("t1", [1], "Para one."), thread("t2", [1], "Para one."), thread("t3", [1], "Para one.")]);
  expect(cards()).toHaveLength(2);
  expect(host.textContent).toMatch(/3 discussions/);
  expect(host.textContent).toMatch("body of t1");
  expect(host.textContent).not.toMatch("body of t2");
  expect(host.textContent).not.toMatch("body of t3");
  act(() => { Array.from(host.querySelectorAll("button")).find(button => /discussions/.test(button.textContent ?? ""))!.click(); });
  expect(cards()).toHaveLength(4);
  expect(host.textContent).toMatch("body of t1");
});

test("the collapsed summary reads as a pile, single threads stay flat", () => {
  renderList([thread("t0", [0], "Para zero."), thread("t1", [1], "Para one."), thread("t2", [1], "Para one."), thread("t3", [1], "Para one.")]);
  const summary = Array.from(host.querySelectorAll<HTMLElement>("[data-review-thread]")).find(el => /Show \d+ discussions/.test(el.textContent ?? ""));
  expect(summary?.hasAttribute("data-stacked")).toBe(true);
  const single = host.querySelector<HTMLElement>(`[data-review-thread="t0"]`);
  expect(single?.hasAttribute("data-stacked")).toBe(false);
});
test("passages with fewer than three threads stay as they are", () => {
  renderList([thread("t0", [0], "Para zero."), thread("t1", [1], "Para one."), thread("t2", [1], "Para one.")]);
  expect(cards()).toHaveLength(3);
  expect(host.textContent).not.toMatch(/discussions/);
});

test("the passage being read and the first group start expanded", () => {
  renderList(
    [thread("t0", [0], "Para zero."), thread("t1", [1], "Para one."), thread("t2", [1], "Para one."), thread("t3", [1], "Para one.")],
    { activeThreadId: "t2" },
  );
  expect(host.textContent).toMatch("body of t1");
  expect(host.textContent).not.toMatch(/3 discussions/);
});
