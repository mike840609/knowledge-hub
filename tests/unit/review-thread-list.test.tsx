// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReviewReplyForm, ReviewThreadList, reviewDraftKey } from "@/components/knowledge/review-thread-list";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const markdown = "Para zero.\n\nPara one.";
let host: HTMLDivElement;
let root: Root | null = null;

function anchor(blockPath: number[], exact: string) {
  return { schemaVersion: 1 as const, blockPath, blockKind: "paragraph" as const, startUtf16: 0, endUtf16: exact.length, exact, prefix: "", suffix: "" };
}

function thread(id: string, blockPath: number[], exact: string, body = `body of ${id}`, mentions?: { name: string; nameEn: string | null; empId: string }[]) {
  return {
    id, status: "OPEN" as const, createdAt: new Date(0), updatedAt: new Date(0),
    currentAnchor: { match: "MATCHED" as const, anchor: anchor(blockPath, exact) },
    comments: [{ id: `${id}-c1`, threadId: id, authorName: "Ann", body, visibility: "VISIBLE" as const, createdAt: new Date(0), editedAt: null, deleted: false, own: false, ...(mentions ? { mentions } : {}) }],
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

function renderList(threads: ReturnType<typeof thread>[], extra?: Partial<typeof props & { activeThreadId?: string; signInHref?: string }>) {
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

function buttons(name: string) {
  return Array.from(host.querySelectorAll("button")).filter(button => button.textContent === name);
}

test("a preview says when its remark was made", () => {
  renderList([thread("t1", [0], "Para zero.")], { writesEnabled: false });
  expect(cards()[0].querySelector("time")).not.toBeNull();
});

test("a short lone remark that cannot be answered offers nothing to open", () => {
  renderList([thread("t1", [0], "Para zero.", "Short.")], { writesEnabled: false });
  expect(buttons("Expand comment")).toHaveLength(0);
});

test("a lone remark cut short by the preview can be opened", () => {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(120);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(40);
  renderList([thread("t1", [0], "Para zero.", "A long remark.")], { writesEnabled: false });
  expect(buttons("Expand comment")).toHaveLength(1);
  vi.restoreAllMocks();
});

test("a reader who is not signed in is offered sign-in to reply on an open discussion", () => {
  renderList([thread("t1", [0], "Para zero."), { ...thread("t2", [1], "Para one."), status: "RESOLVED" as never }], { writesEnabled: false, signInHref: "/?returnTo=%2Fs%2Fabc%2Fopen" });
  const links = Array.from(host.querySelectorAll("a")).filter(link => link.textContent === "Sign in to reply");
  expect(links).toHaveLength(1);
  expect(links[0].getAttribute("href")).toBe("/?returnTo=%2Fs%2Fabc%2Fopen");
  expect(links[0].closest("[data-review-thread]")?.getAttribute("data-review-thread")).toBe("t1");
});

test("http(s) links in a remark are links; anything else stays text", () => {
  renderList([thread("t1", [0], "Para zero.", "See https://example.com/pr/1. <b>bold</b> javascript:alert(1)")], { writesEnabled: false });
  const anchors = Array.from(cards()[0].querySelectorAll("p a"));
  expect(anchors.map(a => [a.getAttribute("href"), a.getAttribute("target"), a.getAttribute("rel")])).toEqual([["https://example.com/pr/1", "_blank", "noopener noreferrer"]]);
  expect(cards()[0].querySelector("b")).toBeNull();
  expect(cards()[0].textContent).toContain("<b>bold</b> javascript:alert(1)");
});

function type(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => { setter.call(textarea, value); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
}

function renderForm(onSubmit: (body: string) => Promise<void> = async () => {}) {
  act(() => {
    root = createRoot(host);
    root.render(createElement(ReviewReplyForm, { draftKey: reviewDraftKey("reply", "t1"), onSubmit }));
  });
}

function remount(onSubmit?: (body: string) => Promise<void>) {
  act(() => root?.unmount());
  renderForm(onSubmit);
}

test("an unsent reply survives the form going away and comes back open", () => {
  sessionStorage.clear();
  renderForm();
  act(() => { buttons("Reply")[0].click(); });
  type(host.querySelector("textarea")!, "Half a thought");
  expect(sessionStorage.getItem(reviewDraftKey("reply", "t1"))).toBe("Half a thought");
  remount();
  expect(host.querySelector("textarea")?.value).toBe("Half a thought");
  // Emptied, nothing is kept.
  type(host.querySelector("textarea")!, "  ");
  expect(sessionStorage.getItem(reviewDraftKey("reply", "t1"))).toBeNull();
});

test("sending or cancelling a reply forgets its draft", async () => {
  sessionStorage.clear();
  const sent: string[] = [];
  renderForm(async (body: string) => { sent.push(body); });
  act(() => { buttons("Reply")[0].click(); });
  type(host.querySelector("textarea")!, "Done");
  await act(async () => { host.querySelector("form")!.requestSubmit(); });
  expect(sent).toEqual(["Done"]);
  expect(sessionStorage.getItem(reviewDraftKey("reply", "t1"))).toBeNull();
  act(() => { buttons("Reply")[0].click(); });
  type(host.querySelector("textarea")!, "Never mind");
  act(() => { buttons("Cancel")[0].click(); });
  expect(sessionStorage.getItem(reviewDraftKey("reply", "t1"))).toBeNull();
  remount();
  expect(host.querySelector("textarea")).toBeNull();
});

test("a collapsed card says it holds an unsent reply", () => {
  sessionStorage.clear();
  sessionStorage.setItem(reviewDraftKey("reply", "t1"), "Kept");
  renderList([thread("t1", [0], "Para zero.")]);
  expect(cards()[0].textContent).toContain("Unsent reply");
  sessionStorage.clear();
});

test("an unread discussion says so inside its first author line, so reading it moves no button", () => {
  const unread = new Set(["a"]);
  act(() => {
    root = createRoot(host);
    root.render(createElement(ReviewThreadList, { threads: [thread("a", [0], "Para zero."), thread("b", [1], "Para one.")] as never, ...props, unreadThreadIds: unread }));
  });
  const [first, second] = cards();
  const name = first.querySelector("li p.font-medium")!;
  expect(name.textContent).toMatch(/^UnreadAnn/);
  // The card has no line of its own for it: what reading takes away is inside the name.
  expect(Array.from(first.children).map(child => child.tagName)).toEqual(Array.from(second.children).map(child => child.tagName));
  expect(second.textContent).not.toContain("Unread");
});

test("a reply offers @ where the list is given a scope, and passes on who was picked", async () => {
  sessionStorage.clear();
  const ming = { id: "11111111-1111-4111-8111-111111111111", name: "陳小明", nameEn: null, empId: "E1" };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ candidates: [ming] }), { headers: { "content-type": "application/json" } })));
  const replies: unknown[][] = [];
  renderList([thread("t1", [0], "Para zero.")], { reply: async (...args: unknown[]) => { replies.push(args); }, mentionScope: { token: "tok" } } as never);
  act(() => { buttons("Reply")[0].click(); });
  const textarea = host.querySelector("textarea")!;
  expect(textarea.getAttribute("aria-autocomplete")).toBe("list");
  type(textarea, "@m");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
  act(() => { textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
  await act(async () => { host.querySelector("form")!.requestSubmit(); });
  expect(replies).toEqual([["t1", "@陳小明 ", expect.any(String), [ming.id], undefined]]);
});

test("editing a comment never offers @", async () => {
  const own = { ...thread("t1", [0], "Para zero."), comments: [{ ...thread("t1", [0], "Para zero.").comments[0], own: true }] };
  renderList([own], { activeThreadId: "t1", mentionScope: { token: "tok" }, author: { edit: async () => {}, remove: async () => {} } } as never);
  await act(async () => { host.querySelector<HTMLElement>('[aria-label="Comment options"]')!.click(); });
  await act(async () => { Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(item => item.textContent === "Edit")!.click(); });
  const field = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Edit comment"]')!;
  expect(field).not.toBeNull();
  expect(field.hasAttribute("aria-autocomplete")).toBe(false);
});

const ming = { name: "陳小明", nameEn: "Ming Chen", empId: "E1234" };
function mentionButtons() {
  return Array.from(host.querySelectorAll<HTMLButtonElement>("p button"));
}
// jsdom does not match :focus-visible after a script's focus(); say it as a keyboard arrival would.
function keyboardFocus(button: HTMLElement) {
  const matches = button.matches.bind(button);
  button.matches = (selector: string) => selector === ":focus-visible" || matches(selector);
  button.focus();
}
function popup() {
  return document.body.querySelector<HTMLElement>("[data-mention-card]");
}

test("a mentioned name is a button named for the person, set in the link colour", () => {
  renderList([thread("t1", [0], "Para zero.", "@陳小明 please check", [ming])], { writesEnabled: false });
  const found = mentionButtons();
  expect(found).toHaveLength(1);
  expect(found[0].getAttribute("aria-label")).toBe("陳小明, mentioned");
  expect(found[0].textContent).toBe("@陳小明");
  expect(found[0].className).toContain("text-kh-link");
  expect(found[0].closest("p")?.textContent).toBe("@陳小明 please check");
});

for (const how of ["focus", "pointerenter", "click"] as const) {
  test(`the card shows name, then name_en · emp_id, on ${how}; it closes again`, async () => {
    vi.useFakeTimers();
    try {
      renderList([thread("t1", [0], "Para zero.", "@陳小明 please check", [ming])], { writesEnabled: false });
      const button = mentionButtons()[0];
      await act(async () => {
        if (how === "focus") keyboardFocus(button);
        else if (how === "pointerenter") { for (const type of ["pointerenter", "mouseenter", "pointermove", "mousemove"]) button.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: type.endsWith("move") }), { pointerType: "mouse" })); await vi.advanceTimersByTimeAsync(500); }
        else { button.focus(); button.click(); }
        await vi.advanceTimersByTimeAsync(50);
      });
      const card = popup();
      expect(card).not.toBeNull();
      expect(card?.textContent).toContain("陳小明");
      expect(card?.textContent).toContain("Ming Chen · E1234");
      await act(async () => {
        if (how === "pointerenter") { for (const type of ["pointerleave", "mouseleave"]) button.dispatchEvent(Object.assign(new MouseEvent(type), { pointerType: "mouse" })); }
        else button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(popup()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
}

test("emp_id stands alone when there is no name_en", async () => {
  renderList([thread("t1", [0], "Para zero.", "@陳小明", [{ ...ming, nameEn: null }])], { writesEnabled: false });
  await act(async () => { mentionButtons()[0].click(); });
  expect(popup()?.textContent).toContain("E1234");
  expect(popup()?.textContent).not.toContain("·");
});

test("people sharing a name share one card per occurrence", async () => {
  renderList([thread("t1", [0], "Para zero.", "@Ann and @Ann", [{ name: "Ann", nameEn: null, empId: "E1" }, { name: "Ann", nameEn: "Ann B", empId: "E2" }])], { writesEnabled: false });
  expect(mentionButtons()).toHaveLength(2);
  await act(async () => { mentionButtons()[1].click(); });
  expect(popup()?.textContent).toContain("E1");
  expect(popup()?.textContent).toContain("Ann B · E2");
});

test("an @ inside a link stays the link", () => {
  renderList([thread("t1", [0], "Para zero.", "see https://x.y/@陳小明", [ming])], { writesEnabled: false });
  expect(host.querySelectorAll("p a[href]")).toHaveLength(1);
  expect(mentionButtons()).toHaveLength(0);
});

test("unmentioned names stay text", () => {
  renderList([thread("t1", [0], "Para zero.", "@Bob hi", [ming])], { writesEnabled: false });
  expect(mentionButtons()).toHaveLength(0);
});

test("clicking a mention does not activate the card; focusing it does not either", async () => {
  const activated: unknown[] = [];
  renderList([thread("t1", [0], "Para zero.", "@陳小明 hi", [ming])], { writesEnabled: false, onActivate: (...a: unknown[]) => { activated.push(a); } } as never);
  const button = mentionButtons()[0];
  await act(async () => { button.focus(); });
  await act(async () => { button.click(); });
  expect(activated).toEqual([]);
});

test("a body's markup is not emitted around a mention", () => {
  renderList([thread("t1", [0], "Para zero.", "<b>@陳小明</b>", [ming])], { writesEnabled: false });
  expect(host.querySelector("b")).toBeNull();
  expect(host.textContent).toContain("<b>");
});

for (const pointerType of ["mouse", "touch"] as const) {
  test(`a ${pointerType} press, in the browser's real event order, leaves the card open`, async () => {
    renderList([thread("t1", [0], "Para zero.", "@陳小明 hi", [ming])], { writesEnabled: false });
    const button = mentionButtons()[0];
    const fire = (type: string) => button.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true }), { pointerType }));
    await act(async () => { fire("pointerdown"); fire("mousedown"); });
    await act(async () => { button.focus(); });
    await act(async () => { fire("pointerup"); fire("mouseup"); fire("click"); });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(popup()).not.toBeNull();
  });
}

test("Escape from the trigger or from inside the card leaves it closed, focus on the trigger", async () => {
  renderList([thread("t1", [0], "Para zero.", "@陳小明 hi", [ming])], { writesEnabled: false });
  const button = mentionButtons()[0];
  const escape = (target: Element) => act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  await act(async () => { keyboardFocus(button); });
  expect(popup()).not.toBeNull();
  await escape(button);
  expect(popup()).toBeNull();
  await act(async () => { button.blur(); keyboardFocus(button); });
  expect(popup()).not.toBeNull();
  await act(async () => { popup()!.focus(); });
  await escape(popup()!);
  expect(popup()).toBeNull();
  expect(document.activeElement).toBe(button);
  expect(button.getAttribute("aria-expanded")).toBe("false");
});
