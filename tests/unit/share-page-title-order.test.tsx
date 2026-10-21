import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MarkdownRenderer } from "@/components/knowledge/markdown-renderer";

const shared = vi.hoisted(() => ({ markdown: "" }));
vi.mock("@/server/share-read", () => ({ getSharedDocument: async () => ({ title: "Saved title", markdown: shared.markdown, sharedByName: "Owner", updatedAt: "2026-10-13", expiresAt: "2026-10-20", revisionId: "revision" }) }));
vi.mock("@/components/knowledge/save-share-button", () => ({ SaveShareButton: () => null }));
vi.mock("@/components/knowledge/shared-review-panel", () => ({ SharedReviewPanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/ui/timestamp", () => ({ Timestamp: () => null }));
import SharedDocumentPage from "@/app/s/[token]/page";

async function page(markdown: string) {
  shared.markdown = markdown;
  return renderToStaticMarkup(await SharedDocumentPage({ params: Promise.resolve({ token: "share-token" }) }));
}
const count = (html: string, text: string) => html.split(text).length - 1;
/** Where each landmark of the page's opening starts, in document order. */
const order = (html: string, ...texts: string[]) => texts.map(text => html.indexOf(text));

// A shared page opens with its title, then who shared it, then the article — whichever title it is.
describe("shared page: title, byline, article", () => {
  it("draws the saved title, then the byline, then the article, when the document has no title of its own", async () => {
    const html = await page("Opening paragraph.\n");
    expect(count(html, "<h1")).toBe(1);
    expect(count(html, "Shared by Owner")).toBe(1);
    const [title, byline, body] = order(html, "Saved title</h1>", "Shared by Owner", "Opening paragraph.");
    expect(title).toBeGreaterThan(-1);
    expect(byline).toBeGreaterThan(title);
    expect(body).toBeGreaterThan(byline);
  });

  it("puts the byline right under the document's own heading, and draws no second title", async () => {
    const html = await page("# Own heading\n\nOpening paragraph.\n\n## Later\n");
    expect(count(html, "<h1")).toBe(1);
    expect(html).not.toContain("Saved title</h1>");
    expect(count(html, "Shared by Owner")).toBe(1);
    const [heading, byline, body] = order(html, "Own heading</h1>", "Shared by Owner", "Opening paragraph.");
    expect(heading).toBeGreaterThan(-1);
    expect(byline).toBeGreaterThan(heading);
    expect(body).toBeGreaterThan(byline);
    // The heading keeps the id an outline entry jumps to.
    expect(html).toMatch(/<h1[^>]*\bid="own-heading"/);
  });

  it("finds the opening heading past a byte-order mark and blank lines", async () => {
    const html = await page("﻿\n  \r\n# Own heading\n\nOpening paragraph.\n");
    expect(count(html, "<h1")).toBe(1);
    const [heading, byline, body] = order(html, "Own heading</h1>", "Shared by Owner", "Opening paragraph.");
    expect(byline).toBeGreaterThan(heading);
    expect(body).toBeGreaterThan(byline);
  });

  it("keeps the byline under the saved title when the document's first `#` heading comes later", async () => {
    const html = await page("Intro.\n\n# Later heading\n\nMore.\n");
    expect(count(html, "Shared by Owner")).toBe(1);
    const [title, byline, intro, later] = order(html, "Saved title</h1>", "Shared by Owner", "Intro.", "Later heading</h1>");
    expect(byline).toBeGreaterThan(title);
    expect(intro).toBeGreaterThan(byline);
    expect(later).toBeGreaterThan(intro);
  });

  it("treats a setext opening as no title of its own, as the reader does", async () => {
    const html = await page("Setext title\n============\n\nOpening paragraph.\n");
    expect(count(html, "Shared by Owner")).toBe(1);
    const [title, byline, setext] = order(html, "Saved title</h1>", "Shared by Owner", "Setext title</h1>");
    expect(byline).toBeGreaterThan(title);
    expect(setext).toBeGreaterThan(byline);
  });

  it("does not make the byline a paragraph of the article, so the prose's paragraph spacing and selectors pass it by", async () => {
    const html = await page("# Own heading\n\nOpening paragraph.\n");
    expect(html).toMatch(/<div class="kh-byline[^"]*">/);
    expect(html).not.toMatch(/<p class="kh-byline/);
  });
});

describe("MarkdownRenderer afterTitle", () => {
  it("is drawn after the opening heading only, never after a later one", () => {
    const html = renderToStaticMarkup(<MarkdownRenderer markdown={"# One\n\ntext\n\n# Two\n"} afterTitle={<i>after</i>} />);
    expect(count(html, "<i>after</i>")).toBe(1);
    expect(html.indexOf("<i>after</i>")).toBeGreaterThan(html.indexOf("One</h1>"));
    expect(html.indexOf("<i>after</i>")).toBeLessThan(html.indexOf(">text<"));
  });

  it("is dropped when the document does not open with a `#` heading", () => {
    for (const markdown of ["Intro\n\n# Later\n", "Setext\n======\n", "## Section\n", ""]) {
      expect(renderToStaticMarkup(<MarkdownRenderer markdown={markdown} afterTitle={<i>after</i>} />), markdown).not.toContain("<i>after</i>");
    }
  });

  it("leaves the rendered document as it was when none is given", () => {
    const markdown = "# One\n\ntext\n";
    const html = renderToStaticMarkup(<MarkdownRenderer markdown={markdown} />);
    expect(html.match(/<\/h1>([\s\S]*?)<p\b/)?.[1].trim()).toBe("");
  });
});
