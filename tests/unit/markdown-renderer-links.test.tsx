import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownRenderer } from "@/components/knowledge/markdown-renderer";
import type { RenderedLinks } from "@/components/knowledge/rendered-links";
import { linkLookupKey } from "@/modules/knowledge/domain/link-graph";

const target = (documentId: string, title: string, ambiguousWith = 0) => ({
  status: "RESOLVED" as const,
  basePath: `/w/w1/knowledge/s1/${documentId}`,
  title,
  ambiguousWith,
});

const links: RenderedLinks = {
  [linkLookupKey("WIKI", "Query Master")]: target("d-qm", "Query Master"),
  [linkLookupKey("WIKI", "Setup")]: target("d-setup", "Setup", 2),
  [linkLookupKey("WIKI", "Missing")]: { status: "UNRESOLVED" },
  [linkLookupKey("PATH", "../notes/b.md")]: target("d-b", "B"),
  [linkLookupKey("PATH", "gone.md")]: { status: "UNRESOLVED" },
};

const render = (markdown: string) => renderToStaticMarkup(<MarkdownRenderer markdown={markdown} links={links} />);
/** No resolutions at all — not the same as resolutions that found nothing, and a default parameter would blur the two. */
const renderWithoutLinks = (markdown: string) => renderToStaticMarkup(<MarkdownRenderer markdown={markdown} />);

describe("wikilinks in the rendered document", () => {
  it("links a resolved [[Target]] into the workspace", () => {
    const html = render("See [[Query Master]] for more.");
    expect(html).toContain('href="/w/w1/knowledge/s1/d-qm"');
    expect(html).toContain(">Query Master</a>");
    expect(html).not.toContain("[[");
  });

  it("matches the way the resolver does: case, spacing and extension do not matter", () => {
    for (const written of ["query master", "  QUERY   Master ", "Query Master.md"]) {
      expect(render(`[[${written}]]`), written).toContain('href="/w/w1/knowledge/s1/d-qm"');
    }
  });

  it("shows the alias, and links the target", () => {
    const html = render("[[Query Master|the master doc]]");
    expect(html).toContain('href="/w/w1/knowledge/s1/d-qm"');
    expect(html).toContain(">the master doc</a>");
  });

  it("carries a heading through as the page anchor, and shows it", () => {
    const html = render("[[Query Master#Local Setup]]");
    expect(html).toContain('href="/w/w1/knowledge/s1/d-qm#local-setup"');
    expect(html).toContain("Query Master › Local Setup");
  });

  it("marks a link to nothing, in words as well as in style, and does not link it", () => {
    const html = render("Try [[Missing]].");
    expect(html).toContain("data-unresolved-link");
    expect(html).toContain("No document titled “Missing” in this workspace");
    expect(html).toContain("(no matching document)");
    expect(html).not.toContain("<a ");
  });

  it("treats a name the server never resolved as unresolved rather than dropping it", () => {
    expect(render("[[Never Heard Of It]]")).toContain("data-unresolved-link");
  });

  it("says when other documents share the name", () => {
    expect(render("[[Setup]]")).toContain("2 other documents share this name");
  });

  it("makes [[#Heading]] a link within the page", () => {
    const html = render("Jump to [[#Local Setup]].\n\n## Local Setup\n");
    expect(html).toContain('href="#local-setup"');
    expect(html).toContain('id="local-setup"');
  });

  it("finds several links in one paragraph, and keeps the text around them", () => {
    const html = render("a [[Query Master]] b [[Missing]] c");
    expect(html.match(/href="\/w\/w1\/knowledge\/s1\/d-qm"/g)).toHaveLength(1);
    expect(html).toContain("data-unresolved-link");
    expect(html).toMatch(/a <a [^>]*>Query Master<\/a> b <span/);
    expect(html).toContain("c</p>");
  });

  it("works inside lists, tables, quotes and headings", () => {
    const html = render("- [[Query Master]]\n\n> [[Query Master]]\n\n| a |\n| - |\n| [[Query Master]] |\n\n## About [[Query Master]]\n");
    expect(html.match(/d-qm/g)?.length).toBe(4);
  });

  it("leaves brackets alone where they are being shown, not written", () => {
    const html = render("`[[Query Master]]`\n\n```\n[[Query Master]]\n```\n\n\\[\\[Query Master\\]\\]\n\n![[Query Master]]\n");
    expect(html).not.toContain("d-qm");
    expect(html).toContain("[[Query Master]]");
  });

  it("does not turn the text of an existing link into a second link", () => {
    const html = render("[see [[Query Master]]](https://example.com)");
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="https://example.com"');
  });

  it("keeps heading ids working alongside", () => {
    expect(render("## Setup [[Query Master]]\n")).toMatch(/<h2 id="[^"]+"/);
  });
});

describe("relative Markdown links in the rendered document", () => {
  it("links a resolved relative .md link into the workspace, with its anchor", () => {
    const html = render("[b](../notes/b.md#top)");
    expect(html).toContain('href="/w/w1/knowledge/s1/d-b#top"');
    expect(html).toContain(">b</a>");
  });

  it("marks one that resolves to nothing", () => {
    const html = render("[gone](gone.md)");
    expect(html).toContain("data-unresolved-link");
    expect(html).toContain("No document at “gone.md” in this source");
    expect(html).not.toContain("<a ");
  });

  it("leaves every other link as it was", () => {
    const html = render("[site](https://example.com/a.md) [pdf](report.pdf) [top](#top)");
    expect(html).toContain('href="https://example.com/a.md"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('href="report.pdf"');
    expect(html).toContain('href="#top"');
    expect(html).not.toContain("data-unresolved-link");
  });
});

describe("without resolutions (a shared page: the reader is not in the workspace)", () => {
  it("reads a wikilink as its text, with no link and no lookup", () => {
    const html = renderWithoutLinks("See [[Query Master]] and [[Note|shown]] and [[Other#Part]].");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("/w/");
    expect(html).toContain("See <span>Query Master</span>");
    expect(html).toContain("<span>shown</span>");
    expect(html).toContain("Other › Part");
  });

  it("reads a relative .md link as its text", () => {
    const html = renderWithoutLinks("[b](../notes/b.md)");
    expect(html).not.toContain("<a ");
    expect(html).toContain("<span>b</span>");
  });

  it("still links to the outside world", () => {
    expect(renderWithoutLinks("[site](https://example.com)")).toContain('href="https://example.com"');
  });
});

describe("an unresolved link the reader may make the document for", () => {
  const CREATE = "/w/w1/knowledge/new?title=Missing&from=d-here";
  const withCreate: RenderedLinks = {
    ...links,
    [linkLookupKey("WIKI", "Missing")]: { status: "UNRESOLVED", createHref: CREATE },
    // Nothing gives a path link a way to be made; if something did, the reader must still not follow it.
    [linkLookupKey("PATH", "gone.md")]: { status: "UNRESOLVED", createHref: "/should-not-be-linked" },
  };
  const renderCreate = (markdown: string) => renderToStaticMarkup(<MarkdownRenderer markdown={markdown} links={withCreate} />);

  it("is a link to the form that makes it, still marked as going nowhere yet, in words as well", () => {
    const html = renderCreate("Try [[Missing]].");
    expect(html).toContain(`href="${CREATE.replace("&", "&amp;")}"`);
    expect(html).toContain("data-unresolved-link");
    expect(html).toContain("data-create-link");
    expect(html).toContain("(no matching document; create it)");
    expect(html).toContain("No document titled “Missing” in this workspace. Create it.");
  });

  it("shows the alias it was written with", () => {
    const html = renderCreate("[[Missing|the missing one]]");
    expect(html).toContain(">the missing one<");
    expect(html).toContain("data-create-link");
    expect(html).not.toContain(">Missing<");
  });

  it("is what it always was — text that goes nowhere — for a reader who was given no address", () => {
    const html = render("Try [[Missing]].");
    expect(html).not.toContain("data-create-link");
    expect(html).not.toContain("<a ");
    expect(html).toContain("(no matching document)");
  });

  it("is not offered for a relative path, which names a place in a source", () => {
    const html = renderCreate("See [the gone one](gone.md).");
    expect(html).not.toContain("data-create-link");
    expect(html).not.toContain("should-not-be-linked");
    expect(html).toContain("data-unresolved-link");
  });

  it("does not touch a link that resolved", () => {
    const html = renderCreate("See [[Query Master]].");
    expect(html).toContain('href="/w/w1/knowledge/s1/d-qm"');
    expect(html).not.toContain("data-create-link");
  });
});
