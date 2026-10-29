// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReviewReplyForm } from "@/components/knowledge/review-thread-list";
import { NO_LINK_HINT, mentionedIds, type MentionScope } from "@/components/knowledge/mention-autocomplete";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MING = { id: "11111111-1111-4111-8111-111111111111", name: "陳小明", nameEn: "Ming Chen", empId: "E1234" };
const MING_TWO = { id: "33333333-3333-4333-8333-333333333333", name: "陳小明", nameEn: "Ming Chen", empId: "E9999" };
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

test("@ at a word start lists who can be mentioned, and the field points at the list", async () => {
  stubFetch();
  const textarea = render({ token: "tok" });
  await type(textarea, "Hi @ming");
  expect(listbox()).not.toBeNull();
  expect(requests).toEqual(["/api/review-mentions/candidates?query=ming&token=tok"]);
  expect(options().map(option => option.textContent)).toEqual(["陳小明Ming Chen · E1234", "林美E5678"]);
  // Still a native textbox: existing callers find it by that role (Ruling 12).
  expect(textarea.hasAttribute("role")).toBe(false);
  expect(textarea.hasAttribute("aria-expanded")).toBe(false);
  expect(textarea.getAttribute("aria-autocomplete")).toBe("list");
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
  expect(textarea.hasAttribute("aria-controls")).toBe(false);
  expect(textarea.hasAttribute("aria-activedescendant")).toBe(false);
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

test("Esc closes the \"No one found\" note first, then is the form's, as before", async () => {
  stubFetch({ candidates: [] });
  const cancelled = vi.fn();
  const textarea = render({ token: "tok" }, [], { onCancel: cancelled, cancelOnEscape: true });
  await type(textarea, "@zz");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
  expect(host.textContent).toContain("No one found.");
  key(textarea, "Escape");
  expect(cancelled).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("No one found.");
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

test("a same-name person picked after the first one's text was deleted is the only one sent", async () => {
  stubFetch({ candidates: [MING, MING_TWO] });
  const sent: Sent[] = [];
  const textarea = render({ token: "tok" }, sent);
  await type(textarea, "@m");
  key(textarea, "Enter");
  await type(textarea, "");
  await type(textarea, "@m");
  key(textarea, "ArrowDown");
  key(textarea, "Enter");
  expect(textarea.value).toBe("@陳小明 ");
  await submit();
  expect(sent).toEqual([{ body: "@陳小明 ", mentions: [MING_TWO.id], linkId: undefined }]);
});

test("a deleted pick is forgotten: its name typed again by hand mentions no one", async () => {
  stubFetch();
  const sent: Sent[] = [];
  const textarea = render({ token: "tok" }, sent);
  await type(textarea, "@m");
  key(textarea, "Enter");
  await type(textarea, "gone");
  await type(textarea, "gone @陳小明 ");
  await submit();
  expect(sent).toEqual([{ body: "gone @陳小明 ", mentions: [], linkId: undefined }]);
});

test("mentionedIds: a pick needs its own whole @name", () => {
  const ming = { id: MING.id, name: MING.name }, two = { id: MING_TWO.id, name: MING_TWO.name }, mei = { id: MEI.id, name: MEI.name };
  // A longer word is not the name.
  expect(mentionedIds("@陳小明明 hi", [ming])).toEqual([]);
  // Whitespace, punctuation and the end all close a name.
  expect(mentionedIds("@陳小明", [ming])).toEqual([MING.id]);
  expect(mentionedIds("@陳小明，請看", [ming])).toEqual([MING.id]);
  expect(mentionedIds("(@林美).", [mei])).toEqual([MEI.id]);
  // Two same-name people are both kept while the text has both occurrences ...
  expect(mentionedIds("@陳小明 and @陳小明 ", [ming, two])).toEqual([MING.id, MING_TWO.id]);
  // ... and with one left, only the most recent pick.
  expect(mentionedIds("@陳小明 ", [ming, two])).toEqual([MING_TWO.id]);
  expect(mentionedIds("", [ming, two, mei])).toEqual([]);
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

test("owner's links are read on each new @: a created link is offered, a revoked one is not", async () => {
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
  // The link is revoked while the composer is open: the next @ asks again and no longer offers it.
  links = [{ id: "link-a", label: "Team", active: false }];
  await type(textarea, "");
  await type(textarea, "@m");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
  expect(requests.filter(url => url.includes("/share-links"))).toHaveLength(3);
  expect(host.textContent).toContain(NO_LINK_HINT);
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
  expect(textarea.hasAttribute("aria-autocomplete")).toBe(false);
  expect(requests).toEqual([]);
  await submit();
  expect(sent).toEqual([{ body: "@ming", mentions: [], linkId: undefined }]);
});

test("a search that finds no one says so", async () => {
  stubFetch({ candidates: [] });
  const textarea = render({ token: "tok" });
  await type(textarea, "@zzz");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
  expect(host.textContent).toContain("No one found.");
  expect(options()).toHaveLength(0);
});
