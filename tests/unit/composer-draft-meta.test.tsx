// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ComposerDraftMeta } from "@/components/knowledge/document-composer";

function mount(html: string) {
  document.body.innerHTML = html;
  return document.body;
}

const base = {
  untitled: false,
  metadataTitle: false,
  renameTarget: null,
  durableDraft: true,
  draftStatus: "saved" as const,
  onRetry: () => {},
};

function status(root: HTMLElement) {
  return root.querySelector("[role='status']")!;
}

describe("the composer's meta line", () => {
  // The smoke suite asserts this sentence with `{ exact: true }`, so the live region must hold the
  // sentence and nothing else. A new note with an `#` heading renames the document, which is enough
  // to put a fact before the status — the case that broke it.
  it("keeps the draft status a sentence of its own, facts or not", () => {
    const root = mount(renderToStaticMarkup(
      <ComposerDraftMeta {...base} renameTarget="New persistent note" />,
    ));
    expect(status(root).textContent).toBe("Draft saved to your account");
    expect(status(root).textContent).not.toContain("·");
    expect(status(root).textContent).not.toContain(",");
  });

  it("names the rename before the status, separated for the eye and for speech", () => {
    const root = mount(renderToStaticMarkup(
      <ComposerDraftMeta {...base} renameTarget="New persistent note" />,
    ));
    const dot = root.querySelector("[aria-hidden='true']")!;
    expect(dot.textContent).toBe("·");
    // Between the fact and the live region: the dot is not inside what gets announced.
    expect(status(root).contains(dot)).toBe(false);
    expect(root.textContent!.indexOf("·")).toBeGreaterThan(root.textContent!.indexOf("Saving will rename"));
    expect(root.textContent!.indexOf("Draft saved")).toBeGreaterThan(root.textContent!.indexOf("·"));
    expect(root.querySelector(".sr-only")?.textContent).toContain(",");
  });

  it("draws no separator when the status is the first thing on the line", () => {
    const root = mount(renderToStaticMarkup(<ComposerDraftMeta {...base} />));
    expect(status(root).textContent).toBe("Draft saved to your account");
    expect(root.querySelector("[aria-hidden='true']")).toBeNull();
    expect(root.querySelector(".sr-only")).toBeNull();
  });

  it("offers a retry only when the draft failed", () => {
    expect(renderToStaticMarkup(<ComposerDraftMeta {...base} draftStatus="error" />)).toContain("Retry draft save");
    expect(renderToStaticMarkup(<ComposerDraftMeta {...base} />)).not.toContain("Retry draft save");
  });
});
