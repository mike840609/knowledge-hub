import { describe, expect, it } from "vitest";
import { createHrefForNode, createLinksFor, newDocumentHref } from "@/lib/create-from-link";
import type { DocumentLinkView, OutgoingLinkView } from "@/modules/knowledge/application/knowledge-link-service";
import { extractDocumentLinks } from "@/modules/knowledge/domain/document-links";
import { linkLookupKey } from "@/modules/knowledge/domain/link-graph";
import { buildLinkResolver } from "@/modules/knowledge/domain/link-resolution";
import { titleForNewDocument } from "@/modules/knowledge/domain/wiki-link-title";
import { renderedLinksFrom } from "@/components/knowledge/rendered-links";

describe("titleForNewDocument", () => {
  it("is the name written in the link, without what the resolver ignores", () => {
    expect(titleForNewDocument("Kubernetes")).toBe("Kubernetes");
    expect(titleForNewDocument("  Kubernetes  ")).toBe("Kubernetes");
    expect(titleForNewDocument("Kubernetes.md")).toBe("Kubernetes");
    expect(titleForNewDocument("Kubernetes.MARKDOWN")).toBe("Kubernetes");
    expect(titleForNewDocument("知識庫 2026")).toBe("知識庫 2026");
    expect(titleForNewDocument("What is a DAG?")).toBe("What is a DAG?");
  });

  it("is nothing when no title could make the link resolve", () => {
    // A path: a Hub document has none to be found by.
    expect(titleForNewDocument("notes/kubernetes")).toBeNull();
    expect(titleForNewDocument("")).toBeNull();
    expect(titleForNewDocument("   ")).toBeNull();
    expect(titleForNewDocument(".md")).toBeNull();
    expect(titleForNewDocument("a|b")).toBeNull();
    expect(titleForNewDocument("a#b")).toBeNull();
    expect(titleForNewDocument("a *b*")).toBeNull();
  });

  it("keeps to the length a title may have", () => {
    expect(titleForNewDocument("x".repeat(512))).toBe("x".repeat(512));
    expect(titleForNewDocument("x".repeat(513))).toBeNull();
  });

  it("gives a title that makes the very link it was made for resolve, for every link written that way", () => {
    const written = [
      "Kubernetes", "kubernetes  upgrade", "  padded  ", "Setup.md", "知識庫", "C++ notes", "What is X?", "a.b.c", "under_score", "100% done",
      "Café", "Café", "２０２６ plan", "Q&A", "a/b", "a|b", "tab\tinside",
    ];
    const markdown = written.map((text) => `- [[${text}]]`).join("\n");
    const links = extractDocumentLinks(markdown).filter((link) => link.kind === "WIKI");
    expect(links.length).toBeGreaterThan(10);
    let made = 0;
    for (const link of links) {
      const title = titleForNewDocument(link.target);
      if (title === null) continue;
      made += 1;
      const resolver = buildLinkResolver([{ documentId: "new", sourceId: "s", title, sourcePath: null, createdAt: new Date(0) }]);
      const resolution = resolver.resolve(link, { documentId: "from", sourceId: "s", sourcePath: null });
      expect(resolution, `[[${link.target}]] → "${title}"`).toMatchObject({ status: "RESOLVED", documentId: "new" });
    }
    expect(made).toBeGreaterThan(10);
  });
});

describe("newDocumentHref", () => {
  const read = (href: string) => {
    const url = new URL(href, "http://hub.test");
    return { path: url.pathname, title: url.searchParams.get("title"), from: url.searchParams.get("from") };
  };

  it("reads back as the title it was given, whatever the title holds", () => {
    for (const title of ["Plain", "with space", "a&b=c", "100%", "q?x#y", "a+b", "知識庫", "“quoted”", "slash/inside", "emoji 🧪"]) {
      expect(read(newDocumentHref("w1", title)), title).toEqual({ path: "/w/w1/knowledge/new", title, from: null });
    }
  });

  it("carries the document to come back to, when there is one", () => {
    expect(read(newDocumentHref("w1", "T", "doc-1"))).toEqual({ path: "/w/w1/knowledge/new", title: "T", from: "doc-1" });
  });
});

describe("createLinksFor", () => {
  function link(kind: "WIKI" | "PATH", target: string, resolved = false): OutgoingLinkView {
    return {
      kind,
      target,
      fragment: null,
      display: null,
      lookupKey: linkLookupKey(kind, target),
      count: 1,
      resolution: resolved ? { status: "RESOLVED", documentId: "d", sourceId: "s", title: target, ambiguousWith: 0 } : { status: "UNRESOLVED" },
    };
  }
  const view = (links: OutgoingLinkView[]): DocumentLinkView => ({
    documentId: "doc-here",
    workspaceId: "w1",
    outgoing: links,
    unresolved: links.filter((entry) => entry.resolution.status === "UNRESOLVED"),
    backlinks: [],
    backlinkTotal: 0,
    index: { documents: 0, stale: 0 },
    localGraph: null,
  });

  it("points each unresolved wikilink at the form that makes it, and says which document it was written in", () => {
    const links = createLinksFor(view([link("WIKI", "Kubernetes"), link("WIKI", "知識庫 2026")]), true);
    expect(Object.keys(links).sort()).toEqual([linkLookupKey("WIKI", "Kubernetes"), linkLookupKey("WIKI", "知識庫 2026")].sort());
    expect(links[linkLookupKey("WIKI", "Kubernetes")]).toBe("/w/w1/knowledge/new?title=Kubernetes&from=doc-here");
    expect(new URL(links[linkLookupKey("WIKI", "知識庫 2026")], "http://x").searchParams.get("title")).toBe("知識庫 2026");
  });

  it("offers nothing to someone who cannot write", () => {
    expect(createLinksFor(view([link("WIKI", "Kubernetes")]), false)).toEqual({});
  });

  it("leaves out a link that is already resolved, a relative path, and a name no title could answer", () => {
    const links = createLinksFor(
      // `gone.md` alone would make a fine title, and is still a path: the link is to a file beside this one.
      view([link("WIKI", "Exists", true), link("PATH", "../gone.md"), link("PATH", "gone.md"), link("WIKI", "a/b"), link("WIKI", "Missing")]),
      true,
    );
    expect(Object.keys(links)).toEqual([linkLookupKey("WIKI", "Missing")]);
  });

  it("uses the title the resolver would match, so the created document resolves the link", () => {
    const links = createLinksFor(view([link("WIKI", "Guide.md")]), true);
    expect(new URL(links[linkLookupKey("WIKI", "Guide.md")], "http://x").searchParams.get("title")).toBe("Guide");
  });
});

describe("createHrefForNode", () => {
  const node = (id: string, kind: "DOCUMENT" | "UNRESOLVED", title: string) => ({ id, kind, title });

  it("is the form for an unresolved wikilink, without a document to come back to", () => {
    expect(createHrefForNode("w1", node("unresolved:WIKI:kubernetes", "UNRESOLVED", "Kubernetes"), true)).toBe("/w/w1/knowledge/new?title=Kubernetes");
  });

  it("is nothing for someone who cannot write, a document, a path, or a name no title could answer", () => {
    expect(createHrefForNode("w1", node("unresolved:WIKI:kubernetes", "UNRESOLVED", "Kubernetes"), false)).toBeNull();
    expect(createHrefForNode("w1", node("doc-1", "DOCUMENT", "Kubernetes"), true)).toBeNull();
    expect(createHrefForNode("w1", node("unresolved:PATH:../x.md", "UNRESOLVED", "../x.md"), true)).toBeNull();
    expect(createHrefForNode("w1", node("unresolved:PATH:x.md", "UNRESOLVED", "x.md"), true)).toBeNull();
    expect(createHrefForNode("w1", node("unresolved:WIKI:a/b", "UNRESOLVED", "a/b"), true)).toBeNull();
  });
});

describe("renderedLinksFrom", () => {
  const key = linkLookupKey("WIKI", "Missing");
  const view = {
    documentId: "doc-here",
    workspaceId: "w1",
    outgoing: [
      { kind: "WIKI", target: "Missing", fragment: null, display: null, lookupKey: key, count: 1, resolution: { status: "UNRESOLVED" } },
      { kind: "WIKI", target: "Known", fragment: null, display: null, lookupKey: linkLookupKey("WIKI", "Known"), count: 1, resolution: { status: "RESOLVED", documentId: "d1", sourceId: "s1", title: "Known", ambiguousWith: 0 } },
    ],
    unresolved: [],
    backlinks: [],
    backlinkTotal: 0,
    index: { documents: 0, stale: 0 },
    localGraph: null,
  } as unknown as DocumentLinkView;

  it("carries the address to make an unresolved link's document, on that link and no other", () => {
    const links = renderedLinksFrom(view, { [key]: "/w/w1/knowledge/new?title=Missing", [linkLookupKey("WIKI", "Known")]: "/never" });
    expect(links[key]).toEqual({ status: "UNRESOLVED", createHref: "/w/w1/knowledge/new?title=Missing" });
    expect(links[linkLookupKey("WIKI", "Known")]).toMatchObject({ status: "RESOLVED", basePath: "/w/w1/knowledge/s1/d1" });
    expect(links[linkLookupKey("WIKI", "Known")]).not.toHaveProperty("createHref");
  });

  it("has no address to carry when none was given", () => {
    expect(renderedLinksFrom(view)[key]).toEqual({ status: "UNRESOLVED" });
  });
});
