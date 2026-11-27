// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SharedReviewPanel } from "@/components/knowledge/shared-review-panel";
import { COMMENT_SHORTCUT, isCommentShortcut } from "@/components/knowledge/review-shortcut";
import { shortcutLabel } from "@/lib/shortcut-keys";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const key = (init: Partial<KeyboardEvent>) => ({ key: "m", code: "KeyM", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false, repeat: false, keyCode: 77, ...init });

describe("isCommentShortcut", () => {
  it("is Ctrl+Alt+M, and ⌘⌥M though a Mac types µ for it", () => {
    expect(isCommentShortcut(key({ ctrlKey: true, altKey: true }))).toBe(true);
    expect(isCommentShortcut(key({ metaKey: true, altKey: true, key: "µ" }))).toBe(true);
  });
  it("is no other key", () => {
    expect(isCommentShortcut(key({}))).toBe(false); // the letter alone: a reader types letters
    expect(isCommentShortcut(key({ ctrlKey: true }))).toBe(false);
    expect(isCommentShortcut(key({ altKey: true }))).toBe(false);
    expect(isCommentShortcut(key({ ctrlKey: true, metaKey: true, altKey: true }))).toBe(false);
    expect(isCommentShortcut(key({ ctrlKey: true, altKey: true, shiftKey: true }))).toBe(false);
    expect(isCommentShortcut(key({ ctrlKey: true, altKey: true, code: "KeyN", key: "n" }))).toBe(false);
    expect(isCommentShortcut(key({ ctrlKey: true, altKey: true, isComposing: true }))).toBe(false);
    expect(isCommentShortcut(key({ ctrlKey: true, altKey: true, repeat: true }))).toBe(false);
  });
  it("is not AltGr, which Windows reports as Ctrl+Alt and which types µ with M on German QWERTZ", () => {
    expect(isCommentShortcut({ ...key({ ctrlKey: true, altKey: true, key: "µ" }), getModifierState: (name: string) => name === "AltGraph" })).toBe(false);
    expect(isCommentShortcut({ ...key({ ctrlKey: true, altKey: true }), getModifierState: () => false })).toBe(true);
  });
  it("is still ⌘⌥M where a browser reports the Mac's Option as AltGraph", () => {
    expect(isCommentShortcut({ ...key({ metaKey: true, altKey: true, key: "µ", code: "KeyM" }), getModifierState: (name: string) => name === "AltGraph" })).toBe(true);
  });
  it("is the key that types M, wherever the layout puts it", () => {
    expect(isCommentShortcut(key({ ctrlKey: true, altKey: true, key: "m", code: "KeyM" }))).toBe(true); // QWERTY
    expect(isCommentShortcut(key({ ctrlKey: true, altKey: true, key: "m", code: "Semicolon" }))).toBe(true); // AZERTY's M
    expect(isCommentShortcut(key({ ctrlKey: true, altKey: true, key: ",", code: "KeyM" }))).toBe(false); // AZERTY's comma, where QWERTY has M
    expect(isCommentShortcut(key({ metaKey: true, altKey: true, key: "µ", code: "KeyM" }))).toBe(true); // macOS ⌥M
  });
  it("reads ⌘⌥M on screen", () => expect(shortcutLabel(COMMENT_SHORTCUT)).toBe("⌘⌥M"));
});

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); window.sessionStorage.clear(); window.localStorage.clear(); });

async function render(callerUserId: string | null) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ threads: [], revisionId: "r1", writesEnabled: callerUserId !== null, callerUserId }), { headers: { "content-type": "application/json" } })));
  await act(async () => root.render(<SharedReviewPanel token="tok" revisionId="r1" markdown="A passage to review." signInHref="/sign-in"><article data-review-document><p data-review-path="0">A passage to review.</p></article><textarea aria-label="Elsewhere" /></SharedReviewPanel>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
function select(text: string) {
  const node = container.querySelector("[data-review-document] p")!.firstChild!;
  const start = node.textContent!.indexOf(text);
  const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + text.length);
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
}
async function press(target: EventTarget = document.body) {
  const event = new KeyboardEvent("keydown", { key: "m", code: "KeyM", ctrlKey: true, altKey: true, bubbles: true, cancelable: true });
  await act(async () => { target.dispatchEvent(event); });
  return event;
}
const composer = () => container.querySelector('textarea[aria-label="Add comment"]');

it("opens the composer on the selected passage for a reader who may comment", async () => {
  await render("u1");
  select("passage");
  const event = await press();
  expect(event.defaultPrevented).toBe(true);
  expect(composer()).not.toBeNull();
  expect(container.querySelector(".kh-review-composer blockquote")!.textContent).toBe("passage");
});

it("does nothing with nothing selected, or in a field of its own", async () => {
  await render("u1");
  expect((await press()).defaultPrevented).toBe(false);
  select("passage");
  expect((await press(container.querySelector('textarea[aria-label="Elsewhere"]')!)).defaultPrevented).toBe(false);
  expect(composer()).toBeNull();
});

it("does nothing for an anonymous reader: the key never takes them off the page", async () => {
  await render(null);
  select("passage");
  expect((await press()).defaultPrevented).toBe(false);
  expect(composer()).toBeNull();
});

