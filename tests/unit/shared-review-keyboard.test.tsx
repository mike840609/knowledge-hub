// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SharedReviewPanel } from "@/components/knowledge/shared-review-panel";

/**
 * Read-only text cannot be selected from the keyboard, so a shared page gives a reader who may write
 * the owner's Comment button beside each paragraph (inline review spec, 2026-11-24 amendment). A
 * reader who may not write gets none: the button is a way into the composer, never a write path.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let discussion: Record<string, unknown>;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(discussion), { status: 200, headers: { "content-type": "application/json" } })));
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); window.localStorage.clear(); window.sessionStorage.clear(); });

const render = async () => {
  await act(async () => root.render(
    <SharedReviewPanel token="tok" revisionId="r1" markdown={"First paragraph.\n\nSecond paragraph."} signInHref="/sign-in">
      <article data-review-document><p data-review-path="0">First paragraph.</p><p data-review-path="1">Second paragraph.</p></article>
    </SharedReviewPanel>,
  ));
};
const paragraphButtons = () => Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter(button => button.getAttribute("aria-label")?.startsWith("Comment on paragraph: "));

it("offers a signed-in reader who may write a Comment button on each paragraph, which opens the composer on it", async () => {
  discussion = { threads: [], revisionId: "r1", writesEnabled: true, callerUserId: "u1" };
  await render();
  expect(paragraphButtons().map(button => button.getAttribute("aria-label"))).toEqual(["Comment on paragraph: First paragraph.", "Comment on paragraph: Second paragraph."]);
  await act(async () => { paragraphButtons()[1].click(); });
  expect(container.querySelector("textarea[aria-label='Add comment']")).not.toBeNull();
  expect(container.querySelector(".kh-review-composer blockquote")?.textContent).toBe("Second paragraph.");
});

it.each([
  ["an anonymous reader", { threads: [], revisionId: "r1", writesEnabled: false, callerUserId: null }],
  ["a signed-in reader while writes are off", { threads: [], revisionId: "r1", writesEnabled: false, callerUserId: "u1" }],
  ["a reader of a document that has changed since the page was read", { threads: [], revisionId: "r2", writesEnabled: true, callerUserId: "u1" }],
])("offers %s no paragraph button", async (_who, answer) => {
  discussion = answer;
  await render();
  expect(paragraphButtons()).toHaveLength(0);
});

describe("the passage being commented on", () => {
  let registry: Map<string, { ranges: Range[] }>;
  beforeEach(() => {
    registry = new Map();
    vi.stubGlobal("CSS", { highlights: registry });
    vi.stubGlobal("Highlight", class { ranges: Range[]; constructor(...ranges: Range[]) { this.ranges = ranges; } });
    discussion = { threads: [], revisionId: "r1", writesEnabled: true, callerUserId: "u1" };
  });
  const cancel = () => Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Cancel")!;

  it("is marked while the composer is open, and unmarked when it is cancelled", async () => {
    await render();
    expect(registry.has("document-review-draft")).toBe(false);
    await act(async () => { paragraphButtons()[0].click(); });
    expect(registry.get("document-review-draft")?.ranges.map(range => range.toString())).toEqual(["First paragraph."]);
    await act(async () => { cancel().click(); });
    expect(registry.has("document-review-draft")).toBe(false);
  });

  it("is unmarked once the comment is sent", async () => {
    await render();
    await act(async () => { paragraphButtons()[0].click(); });
    const field = container.querySelector<HTMLTextAreaElement>("textarea[aria-label='Add comment']")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Sent"); field.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { field.form!.requestSubmit(); });
    expect(registry.has("document-review-draft")).toBe(false);
  });

  it("is unmarked when the panel goes", async () => {
    await render();
    await act(async () => { paragraphButtons()[1].click(); });
    expect(registry.get("document-review-draft")?.ranges.map(range => range.toString())).toEqual(["Second paragraph."]);
    await act(async () => root.unmount());
    root = createRoot(container);
    expect(registry.has("document-review-draft")).toBe(false);
  });
});
