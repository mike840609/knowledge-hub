import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { withoutReviewPaths } from "../fixtures/rendered-markdown";
import { MarkdownRenderer } from "@/components/knowledge/markdown-renderer";
import type { RenderedLinks } from "@/components/knowledge/rendered-links";
import { sharedFolderLinks } from "@/components/knowledge/shared-folder-links";
import { linkLookupKey } from "@/modules/knowledge/domain/link-graph";

/**
 * A folder page links what resolves inside the folder, and reads every other link as the text the
 * author wrote — outside the folder and nowhere at all alike, so neither can be told from the other
 * (folder share spec §5).
 */
const links: RenderedLinks = {
  [linkLookupKey("WIKI", "In")]: { status: "RESOLVED", basePath: "/s/t?d=1", title: "In", ambiguousWith: 0 },
};
const render = (markdown: string, given: RenderedLinks | undefined = links) =>
  withoutReviewPaths(renderToStaticMarkup(<MarkdownRenderer markdown={markdown} links={given} unresolvedAsText />));
const renderWithoutLinks = (markdown: string) => withoutReviewPaths(renderToStaticMarkup(<MarkdownRenderer markdown={markdown} />));

describe("links on a shared folder page", () => {
  it("links an in-folder [[wikilink]] to its document within the folder link", () => {
    const html = render("See [[In]].");
    expect(html).toMatch(/<a [^>]*href="\/s\/t\?d=1"[^>]*>In<\/a>/);
  });

  it("keeps a heading fragment on an in-folder link", () => {
    expect(render("See [[In#Setup steps]].")).toContain('href="/s/t?d=1#setup-steps"');
  });

  it("reads an out-of-folder [[wikilink]], a relative .md link and a link with no resolutions as the same plain text", () => {
    const wiki = render("See [[Out]].").replace("Out", "X");
    const path = render("See [Out](../out.md).").replace("Out", "X");
    const none = renderWithoutLinks("See [[Out]].").replace("Out", "X");
    expect(wiki).toBe(none);
    expect(path).toBe(none);
    expect(wiki).toContain("<p>See <span>X</span>.</p>");
  });

  it("an UNRESOLVED entry reads exactly as a missing one: no dashed styling, no tooltip, no words about it", () => {
    const unresolved = render("See [[Gone]] and [gone](gone.md).", { [linkLookupKey("WIKI", "Gone")]: { status: "UNRESOLVED", createHref: "/create" }, [linkLookupKey("PATH", "gone.md")]: { status: "UNRESOLVED" } });
    const missing = render("See [[Gone]] and [gone](gone.md).", {});
    expect(unresolved).toBe(missing);
    for (const html of [unresolved, missing]) {
      expect(html).not.toContain("data-unresolved-link");
      expect(html).not.toContain("border-dashed");
      expect(html).not.toContain("title=");
      expect(html).not.toContain("No document");
      expect(html).not.toContain("/create");
    }
  });

  it("without the flag, the owner's reader still marks a link that resolves nowhere", () => {
    const html = withoutReviewPaths(renderToStaticMarkup(<MarkdownRenderer markdown="See [[Out]]." links={links} />));
    expect(html).toContain("data-unresolved-link");
  });
});

describe("sharedFolderLinks", () => {
  it("points each in-folder link at the folder page's ?d=, with no preview id and no other-documents count", () => {
    const built = sharedFolderLinks("tok", [{ lookupKey: linkLookupKey("WIKI", "In"), documentId: "0192f3a4-5b6c-7d8e-9f01-23456789abcd", title: "In" }]);
    expect(built).toEqual({
      [linkLookupKey("WIKI", "In")]: { status: "RESOLVED", basePath: "/s/tok?d=0192f3a4-5b6c-7d8e-9f01-23456789abcd", title: "In", ambiguousWith: 0 },
    });
    const html = render("[[In]]", built);
    expect(html).not.toContain("share this name");
  });

  it("holds nothing when the document links nowhere inside the folder", () => {
    expect(sharedFolderLinks("tok", [])).toEqual({});
  });
});
