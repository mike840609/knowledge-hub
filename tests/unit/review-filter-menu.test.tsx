// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ReviewFilterMenu, ReviewNextButtons, reviewShows } from "@/components/knowledge/review-thread-list";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("the filter marks the current choice and reports a new one", async () => {
  const onChange = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(<ReviewFilterMenu value="OPEN" onChange={onChange} />));
  await act(async () => (document.querySelector('[aria-label="Filter comments"]') as HTMLElement).click());
  const rows = [...document.querySelectorAll('[role="menuitemradio"]')] as HTMLElement[];
  expect(rows.map(row => [row.textContent, row.getAttribute("aria-checked")])).toEqual([["All comments", "false"], ["Open", "true"], ["Resolved", "false"]]);
  await act(async () => rows[2].click());
  expect(onChange).toHaveBeenCalledWith("RESOLVED");
  await act(async () => root.unmount());
});

it("offers whose discussions, as a second group, where it is given them", async () => {
  const onShowChange = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(<ReviewFilterMenu value="OPEN" onChange={vi.fn()} show="MINE" shows={["ANYONE", "MINE", "MENTIONS"]} onShowChange={onShowChange} />));
  const trigger = document.querySelector('[aria-label="Filter comments"]') as HTMLElement;
  expect(trigger.textContent).toBe("Open · Mine");
  await act(async () => trigger.click());
  const rows = [...document.querySelectorAll('[role="menuitemradio"]')] as HTMLElement[];
  expect(rows.map(row => [row.textContent, row.getAttribute("aria-checked")])).toEqual([["All comments", "false"], ["Open", "true"], ["Resolved", "false"], ["Everyone", "false"], ["Mine", "true"], ["Mentions me", "false"]]);
  await act(async () => rows[5].click());
  expect(onShowChange).toHaveBeenCalledWith("MENTIONS");
  await act(async () => root.unmount());
  host.remove();
});

it("lists a discussion as Mine where the caller wrote any comment, and as Mentions me where one names them", () => {
  const thread = (...comments: { own: boolean; mentionsMe?: true }[]) => ({ comments });
  expect(reviewShows(thread({ own: false }, { own: true }), "MINE")).toBe(true);
  expect(reviewShows(thread({ own: false }), "MINE")).toBe(false);
  expect(reviewShows(thread({ own: false }, { own: false, mentionsMe: true }), "MENTIONS")).toBe(true);
  expect(reviewShows(thread({ own: true }), "MENTIONS")).toBe(false);
  expect(reviewShows(thread({ own: false }), "ANYONE")).toBe(true);
});

it("Next open stays among whose discussions are shown", async () => {
  const onActivate = vi.fn();
  const at = (path: number) => ({ match: "MATCHED" as const, anchor: { schemaVersion: 1 as const, blockPath: [path], blockKind: "paragraph" as const, startUtf16: 0, endUtf16: 1, exact: "x", prefix: "", suffix: "" } });
  const make = (id: string, path: number, own: boolean) => ({ id, status: "OPEN" as const, createdAt: new Date(), updatedAt: new Date(), currentAnchor: at(path), comments: [{ id: `${id}c`, threadId: id, body: "b", visibility: "VISIBLE" as const, createdAt: new Date(), editedAt: null, deleted: false, own }] });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(<ReviewNextButtons threads={[make("other", 0, false), make("mine", 1, true)]} onActivate={onActivate} filter="OPEN" onFilterChange={vi.fn()} show="MINE" onShowChange={vi.fn()} />));
  const next = [...host.querySelectorAll("button")].find(button => button.textContent === "Next open")!;
  await act(async () => next.click());
  expect(onActivate).toHaveBeenCalledWith("mine");
  await act(async () => root.unmount());
  host.remove();
});
