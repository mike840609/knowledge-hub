// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReviewReplyForm } from "@/components/knowledge/review-thread-list";
import { NO_LINK_HINT, type MentionScope } from "@/components/knowledge/mention-autocomplete";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MING = { id: "11111111-1111-4111-8111-111111111111", name: "陳小明", nameEn: "Ming Chen", empId: "E1234" };
const MEI = { id: "22222222-2222-4222-8222-222222222222", name: "林美", nameEn: null, empId: "E5678" };

let host: HTMLDivElement;
let root: Root | null = null;
let requests: string[];

type Sent = { body: string; mentions: string[]; linkId?: string };

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

type Link = { id: string; label: string | null; active: boolean };
function stubFetch({ candidates = [MING, MEI], links = [] as Link[] | (() => Link[]) } = {}) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    requests.push(url);
    if (url.includes("/share-links")) return json({ links: typeof links === "function" ? links() : links });
    if (url.startsWith("/api/review-mentions/candidates")) return json({ candidates });
    throw new Error(`unexpected ${url}`);
  }));
}

beforeEach(() => {
  requests = [];
  sessionStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  vi.unstubAllGlobals();
});

function render(mentionScope: MentionScope | undefined, sent: Sent[] = [], extra: Record<string, unknown> = {}) {
  act(() => {
    root = createRoot(host);
    root.render(createElement(ReviewReplyForm, {
      label: "Add comment", mentionScope, ...extra,
      onSubmit: async (body: string, _key: string, mentions: string[], linkId?: string) => { sent.push({ body, mentions, linkId }); },
    }));
  });
  return host.querySelector("textarea")!;
}

/** Types `value` with the caret at its end, then lets the debounce and the fetch settle. */
async function type(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => { setter.call(textarea, value); textarea.setSelectionRange(value.length, value.length); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
}

function key(textarea: HTMLTextAreaElement, name: string) {
  act(() => { textarea.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
}

const listbox = () => host.querySelector<HTMLElement>('[role="listbox"]');
const options = () => Array.from(host.querySelectorAll<HTMLElement>('[role="option"]'));
const submit = async () => { await act(async () => { host.querySelector("form")!.requestSubmit(); }); };

test("@ at a word start lists who can be mentioned, as a combobox", async () => {
  stubFetch();
  const textarea = render({ token: "tok" });
  await type(textarea, "Hi @ming");
  expect(listbox()).not.toBeNull();
  expect(requests).toEqual(["/api/review-mentions/candidates?query=ming&token=tok"]);
  expect(options().map(option => option.textContent)).toEqual(["陳小明Ming Chen · E1234", "林美E5678"]);
  expect(textarea.getAttribute("role")).toBe("combobox");
  expect(textarea.getAttribute("aria-expanded")).toBe("true");
  expect(textarea.getAttribute("aria-controls")).toBe(listbox()!.id);
  expect(textarea.getAttribute("aria-activedescendant")).toBe(options()[0].id);
});

test("arrow keys move the row in force; Enter inserts the name and sends its id", async () => {
  stubFetch();
  const sent: Sent[] = [];
  const textarea = render({ token: "tok" }, sent);
  await type(textarea, "Hi @m");
  key(textarea, "ArrowDown");
  expect(textarea.getAttribute("aria-activedescendant")).toBe(options()[1].id);
  key(textarea, "ArrowUp");
  key(textarea, "Enter");
  expect(textarea.value).toBe("Hi @陳小明 ");
  expect(textarea.selectionStart).toBe("Hi @陳小明 ".length);
  expect(listbox()).toBeNull();
  expect(textarea.getAttribute("aria-expanded")).toBe("false");
  await submit();
  expect(sent).toEqual([{ body: "Hi @陳小明 ", mentions: [MING.id], linkId: undefined }]);
});

test("Tab picks too, and the name goes in at the caret, not at the end", async () => {
  stubFetch();
  const textarea = render({ token: "tok" });
  await type(textarea, "@l");
  // The caret is after `@l`; text after it stays.
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => { setter.call(textarea, "@l tail"); textarea.setSelectionRange(2, 2); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
  key(textarea, "ArrowDown");
  key(textarea, "Tab");
  expect(textarea.value).toBe("@林美  tail");
});

test("Esc closes the list and leaves the form open", async () => {
  stubFetch();
  const cancelled = vi.fn();
  const textarea = render({ token: "tok" }, [], { onCancel: cancelled, cancelOnEscape: true });
  await type(textarea, "@ming");
  key(textarea, "Escape");
  expect(listbox()).toBeNull();
  expect(cancelled).not.toHaveBeenCalled();
  expect(host.querySelector("textarea")).not.toBeNull();
  // A second Esc is the form's again.
  key(textarea, "Escape");
  expect(cancelled).toHaveBeenCalledTimes(1);
});

test("Esc with nothing shown is the form's, as before", async () => {
  stubFetch({ candidates: [] });
  const cancelled = vi.fn();
  const textarea = render({ token: "tok" }, [], { onCancel: cancelled, cancelOnEscape: true });
  await type(textarea, "@zz");
  expect(listbox()).toBeNull();
  key(textarea, "Escape");
  expect(cancelled).toHaveBeenCalledTimes(1);
});

test("@ inside a word opens nothing", async () => {
  stubFetch();
  const textarea = render({ token: "tok" });
  await type(textarea, "mail a@b");
  expect(listbox()).toBeNull();
  expect(requests).toEqual([]);
});

test("a name deleted from the text before sending is not mentioned", async () => {
  stubFetch();
  const sent: Sent[] = [];
  const textarea = render({ token: "tok" }, sent);
  await type(textarea, "@ming");
  key(textarea, "Enter");
  await type(textarea, textarea.value + "and @l");
  key(textarea, "ArrowDown");
  key(textarea, "Enter");
  expect(textarea.value).toBe("@陳小明 and @林美 ");
  await type(textarea, "and @林美 ");
  await submit();
  expect(sent).toEqual([{ body: "and @林美 ", mentions: [MEI.id], linkId: undefined }]);
});

test("a comment without a pick sends no mentions", async () => {
  stubFetch();
  const sent: Sent[] = [];
  const textarea = render({ token: "tok" }, sent);
  await type(textarea, "plain @陳小明 typed by hand");
  await submit();
  expect(sent).toEqual([{ body: "plain @陳小明 typed by hand", mentions: [], linkId: undefined }]);
});

test("owner with no live link: @ says to create one and offers nobody", async () => {
  stubFetch({ links: [{ id: "dead", label: "Old", active: false }] });
  const textarea = render({ documentId: "doc-1" });
  await type(textarea, "@");
  expect(host.textContent).toContain("Create a share link first to mention someone");
  await type(textarea, "@ming");
  expect(options()).toHaveLength(0);
  expect(requests.filter(url => url.includes("candidates"))).toEqual([]);
  // Links are loaded once, when the list first opens.
  expect(requests).toEqual(["/api/documents/doc-1/share-links"]);
});

test("owner who creates a link after seeing the hint is offered people on the next @", async () => {
  let links: Link[] = [];
  stubFetch({ links: () => links });
  const textarea = render({ documentId: "doc-1" });
  await type(textarea, "@");
  expect(host.textContent).toContain(NO_LINK_HINT);
  await type(textarea, "");
  links = [{ id: "link-a", label: "Team", active: true }];
  await type(textarea, "@ming");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
  expect(host.textContent).not.toContain(NO_LINK_HINT);
  expect(options()).toHaveLength(2);
  expect(requests.filter(url => url.includes("/share-links"))).toHaveLength(2);
  // Once a live link is known, a further @ does not ask again.
  await type(textarea, "");
  await type(textarea, "@m");
  expect(requests.filter(url => url.includes("/share-links"))).toHaveLength(2);
});

test("owner with two live links chooses one under Share via, and it is sent", async () => {
  stubFetch({ links: [{ id: "link-a", label: "Team", active: true }, { id: "gone", label: "Gone", active: false }, { id: "link-b", label: null, active: true }] });
  const sent: Sent[] = [];
  const textarea = render({ documentId: "doc-1" }, sent);
  expect(host.querySelector("select")).toBeNull();
  await type(textarea, "@ming");
  expect(requests).toContain("/api/review-mentions/candidates?query=ming&documentId=doc-1");
  // Nobody picked yet: nothing to choose.
  expect(host.querySelector("select")).toBeNull();
  key(textarea, "Enter");
  const select = host.querySelector("select")!;
  expect(select).not.toBeNull();
  expect(Array.from(select.options).map(option => option.value)).toEqual(["link-a", "link-b"]);
  expect(host.querySelector("label")?.textContent).toContain("Share via");
  act(() => { select.value = "link-b"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await submit();
  expect(sent).toEqual([{ body: "@陳小明 ", mentions: [MING.id], linkId: "link-b" }]);
});

test("owner with one live link: no choice, its id is sent", async () => {
  stubFetch({ links: [{ id: "link-a", label: "Team", active: true }] });
  const sent: Sent[] = [];
  const textarea = render({ documentId: "doc-1" }, sent);
  await type(textarea, "@ming");
  key(textarea, "Enter");
  expect(host.querySelector("select")).toBeNull();
  await submit();
  expect(sent).toEqual([{ body: "@陳小明 ", mentions: [MING.id], linkId: "link-a" }]);
});

test("owner without a pick sends no link", async () => {
  stubFetch({ links: [{ id: "link-a", label: "Team", active: true }] });
  const sent: Sent[] = [];
  const textarea = render({ documentId: "doc-1" }, sent);
  await type(textarea, "No one");
  await submit();
  expect(sent).toEqual([{ body: "No one", mentions: [], linkId: undefined }]);
});

test("without a mention scope, @ does nothing", async () => {
  stubFetch();
  const sent: Sent[] = [];
  const textarea = render(undefined, sent);
  await type(textarea, "@ming");
  expect(listbox()).toBeNull();
  expect(textarea.hasAttribute("role")).toBe(false);
  expect(requests).toEqual([]);
  await submit();
  expect(sent).toEqual([{ body: "@ming", mentions: [], linkId: undefined }]);
});
