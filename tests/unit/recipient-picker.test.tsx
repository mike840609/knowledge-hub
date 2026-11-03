// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RecipientPicker, type Recipient } from "@/components/knowledge/recipient-picker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MING: Recipient = { id: "11111111-1111-4111-8111-111111111111", name: "陳小明", nameEn: "Ming Chen", empId: "E1234" };
const MEI: Recipient = { id: "22222222-2222-4222-8222-222222222222", name: "林美", nameEn: null, empId: "E5678" };

let host: HTMLDivElement;
let root: Root | null = null;
let requests: string[];
let changes: Recipient[][];

function stubFetch(candidates: Recipient[] = [MING, MEI]) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    requests.push(url);
    return new Response(JSON.stringify({ candidates }), { status: 200, headers: { "content-type": "application/json" } });
  }));
}

/** Holds the chosen people the way a dialog does, and records each change. */
function Harness({ initial = [], disabled = false, exclude }: { initial?: Recipient[]; disabled?: boolean; exclude?: string[] }) {
  const [value, setValue] = useState<Recipient[]>(initial);
  return createElement(RecipientPicker, { value, disabled, exclude, onChange: (next: Recipient[]) => { changes.push(next); setValue(next); } });
}

beforeEach(() => {
  requests = [];
  changes = [];
  host = document.createElement("div");
  document.body.appendChild(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  vi.unstubAllGlobals();
});

function render(props: Parameters<typeof Harness>[0] = {}) {
  act(() => { root = createRoot(host); root.render(createElement(Harness, props)); });
  return host.querySelector<HTMLInputElement>('input[role="combobox"]')!;
}

async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
}
function key(input: HTMLInputElement, name: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
  act(() => { input.dispatchEvent(event); });
  return event;
}
const options = () => Array.from(host.querySelectorAll<HTMLElement>('[role="option"]'));
const chips = () => Array.from(host.querySelectorAll<HTMLElement>('ul[aria-label="Selected people"] li'));

test("typing asks the endpoint once, after the debounce, and lists each person as name · empId · nameEn", async () => {
  stubFetch();
  const input = render();
  act(() => { for (const value of ["陳", "陳小", "陳小明"]) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); } });
  expect(requests).toEqual([]);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
  expect(requests).toEqual(["/api/share-recipients/candidates?query=%E9%99%B3%E5%B0%8F%E6%98%8E"]);
  expect(options().map((option) => option.textContent)).toEqual(["陳小明 · E1234 · Ming Chen", "林美 · E5678"]);
});

test("the field is a combobox that owns a labelled listbox and points at the row in force", async () => {
  stubFetch();
  const input = render();
  expect(input.getAttribute("aria-expanded")).toBe("false");
  expect(input.getAttribute("aria-autocomplete")).toBe("list");
  expect(input.getAttribute("aria-label") ?? host.querySelector(`label[for="${input.id}"]`)?.textContent).toBeTruthy();
  await type(input, "m");
  const listbox = host.querySelector<HTMLElement>('[role="listbox"]')!;
  expect(listbox.getAttribute("aria-label")).toBeTruthy();
  expect(input.getAttribute("aria-expanded")).toBe("true");
  expect(input.getAttribute("aria-controls")).toBe(listbox.id);
  expect(input.getAttribute("aria-activedescendant")).toBe(options()[0].id);
  expect(options()[0].getAttribute("aria-selected")).toBe("true");
});

test("clicking an option adds a chip and clears the search", async () => {
  stubFetch();
  const input = render();
  await type(input, "m");
  act(() => { options()[1].click(); });
  expect(changes).toEqual([[MEI]]);
  expect(chips().map((chip) => chip.textContent)).toEqual(["林美"]);
  expect(input.value).toBe("");
  expect(options()).toEqual([]);
});

test("a person already chosen is not offered again, so no duplicate chip can be made", async () => {
  stubFetch();
  const input = render();
  await type(input, "m");
  act(() => { options()[0].click(); });
  await type(input, "m");
  expect(options().map((option) => option.textContent)).toEqual(["林美 · E5678"]);
  expect(changes).toEqual([[MING]]);
});

test("people named by `exclude` are never offered", async () => {
  stubFetch();
  const input = render({ exclude: [MING.id] });
  await type(input, "m");
  expect(options().map((option) => option.textContent)).toEqual(["林美 · E5678"]);
});

test("each chip has a button that removes its person", async () => {
  stubFetch();
  render({ initial: [MING, MEI] });
  const remove = host.querySelector<HTMLButtonElement>('button[aria-label="Remove 陳小明"]')!;
  act(() => { remove.click(); });
  expect(changes).toEqual([[MEI]]);
  expect(chips().map((chip) => chip.textContent)).toEqual(["林美"]);
});

test("arrow keys move the row in force; Enter adds it and does not submit a surrounding form", async () => {
  stubFetch();
  const input = render();
  await type(input, "m");
  key(input, "ArrowDown");
  expect(input.getAttribute("aria-activedescendant")).toBe(options()[1].id);
  key(input, "ArrowDown");
  expect(input.getAttribute("aria-activedescendant")).toBe(options()[0].id);
  key(input, "ArrowUp");
  expect(input.getAttribute("aria-activedescendant")).toBe(options()[1].id);
  const enter = key(input, "Enter");
  expect(enter.defaultPrevented).toBe(true);
  expect(changes).toEqual([[MEI]]);
});

test("Enter with no list open is swallowed too, so typing a name never submits the dialog's form", () => {
  stubFetch();
  const input = render();
  expect(key(input, "Enter").defaultPrevented).toBe(true);
  expect(changes).toEqual([]);
});

test("Escape closes the list and keeps the event from closing the dialog around it; with no list it passes", async () => {
  stubFetch();
  const input = render();
  await type(input, "m");
  const bubbled = vi.fn();
  document.body.addEventListener("keydown", bubbled);
  key(input, "Escape");
  expect(options()).toEqual([]);
  expect(input.getAttribute("aria-expanded")).toBe("false");
  expect(bubbled).not.toHaveBeenCalled();
  key(input, "Escape");
  expect(bubbled).toHaveBeenCalledTimes(1);
  document.body.removeEventListener("keydown", bubbled);
});

test("a search that finds no one says so, and a failed one says that instead", async () => {
  stubFetch([]);
  const input = render();
  await type(input, "zzz");
  expect(host.textContent).toContain("No one found.");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "X", message: "Directory is down." } }), { status: 503, headers: { "content-type": "application/json" } })));
  await type(input, "zzzz");
  expect(host.textContent).toContain("Directory is down.");
});

test("a blank search asks nothing", async () => {
  stubFetch();
  const input = render();
  await type(input, "   ");
  expect(requests).toEqual([]);
});

test("disabled disables the field and every chip's remove button", () => {
  stubFetch();
  const input = render({ initial: [MING], disabled: true });
  expect(input.disabled).toBe(true);
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="Remove 陳小明"]')!.disabled).toBe(true);
});

const typeNow = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
};

test("while the next search is on its way the last list stays in view but nobody can be picked from it", async () => {
  stubFetch();
  const input = render();
  await type(input, "陳");
  expect(options()).toHaveLength(2);
  typeNow(input, "陳小");
  // Still shown, so it does not blink away; but it answers "陳", not "陳小".
  expect(options()).toHaveLength(2);
  expect(host.querySelector('[role="listbox"]')!.getAttribute("aria-busy")).toBe("true");
  expect(input.getAttribute("aria-activedescendant")).toBeNull();
  expect(key(input, "Enter").defaultPrevented).toBe(true);
  act(() => { options()[1].click(); });
  expect(changes).toEqual([]);
  // Once the answer for "陳小" arrives, it can be picked.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
  expect(host.querySelector('[role="listbox"]')!.getAttribute("aria-busy")).toBe("false");
  key(input, "Enter");
  expect(changes).toEqual([[MING]]);
});

test("a failed search takes the last list down, and retyping does not bring it back", async () => {
  stubFetch();
  const input = render();
  await type(input, "陳");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "X", message: "Directory is down." } }), { status: 503, headers: { "content-type": "application/json" } })));
  await type(input, "陳小");
  expect(options()).toHaveLength(0);
  expect(input.getAttribute("aria-expanded")).toBe("false");
  expect(host.textContent).toContain("Directory is down.");
  typeNow(input, "陳小明");
  expect(options()).toHaveLength(0);
});

test("clearing the field forgets the last answer, so a new search starts with no list", async () => {
  stubFetch();
  const input = render();
  await type(input, "陳");
  typeNow(input, "");
  typeNow(input, "林");
  expect(options()).toHaveLength(0);
});

test("leaving the field closes the list and its hint; typing again opens it", async () => {
  stubFetch();
  const input = render();
  await type(input, "陳");
  expect(options()).toHaveLength(2);
  act(() => { input.focus(); input.blur(); });
  expect(options()).toHaveLength(0);
  expect(input.getAttribute("aria-expanded")).toBe("false");
  typeNow(input, "陳小");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
  expect(options()).toHaveLength(2);
});
