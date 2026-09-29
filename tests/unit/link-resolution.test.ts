import { describe, expect, it } from "vitest";
import {
  buildLinkResolver,
  normalizeLinkKey,
  resolveRelativeSourcePath,
  type CatalogDocument,
  type LinkOrigin,
} from "@/modules/knowledge/domain/link-resolution";

const SOURCE_A = "source-a";
const SOURCE_B = "source-b";
let sequence = 0;

function doc(overrides: Partial<CatalogDocument> & { documentId: string }): CatalogDocument {
  sequence += 1;
  return {
    sourceId: SOURCE_A,
    title: overrides.documentId,
    sourcePath: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
    ...overrides,
  };
}

const from = (overrides: Partial<LinkOrigin> = {}): LinkOrigin => ({ documentId: "origin", sourceId: SOURCE_A, sourcePath: null, ...overrides });
const wiki = (target: string) => ({ kind: "WIKI" as const, target });
const path = (target: string) => ({ kind: "PATH" as const, target });
const resolved = (documentId: string, ambiguousWith = 0) => ({ status: "RESOLVED", documentId, ambiguousWith });
const unresolved = { status: "UNRESOLVED" };

describe("normalizeLinkKey", () => {
  it("composes, trims, single-spaces and folds case", () => {
    expect(normalizeLinkKey("  Query   Master ")).toBe("query master");
    expect(normalizeLinkKey("Café")).toBe(normalizeLinkKey("Café"));
    expect(normalizeLinkKey("ＡＢＣ")).toBe("ａｂｃ");
  });
});

describe("resolveRelativeSourcePath", () => {
  it("resolves against the directory of the origin", () => {
    expect(resolveRelativeSourcePath("notes/a.md", "b.md")).toBe("notes/b.md");
    expect(resolveRelativeSourcePath("notes/a.md", "./b.md")).toBe("notes/b.md");
    expect(resolveRelativeSourcePath("notes/deep/a.md", "../b.md")).toBe("notes/b.md");
    expect(resolveRelativeSourcePath("a.md", "sub/b.md")).toBe("sub/b.md");
  });

  it("treats a leading slash as the source root", () => {
    expect(resolveRelativeSourcePath("notes/deep/a.md", "/top/b.md")).toBe("top/b.md");
  });

  it("refuses to climb out of the source", () => {
    expect(resolveRelativeSourcePath("a.md", "../b.md")).toBeNull();
    expect(resolveRelativeSourcePath("notes/a.md", "../../b.md")).toBeNull();
    expect(resolveRelativeSourcePath("a.md", "..")).toBeNull();
  });

  it("collapses empty and dot segments", () => {
    expect(resolveRelativeSourcePath("a/b.md", "c//./d.md")).toBe("a/c/d.md");
  });
});

describe("wikilinks", () => {
  it("resolves by title, case- and space-insensitively", () => {
    const resolver = buildLinkResolver([doc({ documentId: "d1", title: "Query Master" })]);
    expect(resolver.resolve(wiki("Query Master"), from())).toEqual(resolved("d1"));
    expect(resolver.resolve(wiki("query   master"), from())).toEqual(resolved("d1"));
    expect(resolver.resolve(wiki("QUERY MASTER"), from())).toEqual(resolved("d1"));
    expect(resolver.resolve(wiki("Query Master.md"), from())).toEqual(resolved("d1"));
  });

  it("resolves by file name when the title came from elsewhere", () => {
    const resolver = buildLinkResolver([doc({ documentId: "d1", title: "Architecture Overview", sourcePath: "wiki/arch-overview.md" })]);
    expect(resolver.resolve(wiki("arch-overview"), from())).toEqual(resolved("d1"));
    expect(resolver.resolve(wiki("Architecture Overview"), from())).toEqual(resolved("d1"));
  });

  it("matches a path-qualified target on whole trailing segments", () => {
    const resolver = buildLinkResolver([
      doc({ documentId: "d1", title: "Source", sourcePath: "x/Notes/Source.md" }),
      doc({ documentId: "d2", title: "Source", sourcePath: "y/MyNotes/Source.md" }),
    ]);
    expect(resolver.resolve(wiki("Notes/Source"), from())).toEqual(resolved("d1"));
    expect(resolver.resolve(wiki("x/Notes/Source"), from())).toEqual(resolved("d1"));
    // "MyNotes" is not "Notes": segment boundaries, not string suffixes.
    expect(resolver.resolve(wiki("Notes/Source"), from())).not.toEqual(resolved("d2"));
  });

  it("does not let a title satisfy a path-qualified target", () => {
    const resolver = buildLinkResolver([doc({ documentId: "d1", title: "Notes/Source" })]);
    expect(resolver.resolve(wiki("Notes/Source"), from())).toEqual(unresolved);
  });

  it("is unresolved when nothing matches, or the target is empty", () => {
    const resolver = buildLinkResolver([doc({ documentId: "d1", title: "Alpha" })]);
    expect(resolver.resolve(wiki("Beta"), from())).toEqual(unresolved);
    expect(resolver.resolve(wiki("   "), from())).toEqual(unresolved);
    expect(resolver.resolve(wiki(".md"), from())).toEqual(unresolved);
  });

  it("resolves an empty catalog to nothing", () => {
    expect(buildLinkResolver([]).resolve(wiki("Anything"), from())).toEqual(unresolved);
  });

  describe("when several documents match", () => {
    it("prefers the origin's own source", () => {
      const resolver = buildLinkResolver([
        doc({ documentId: "in-b", sourceId: SOURCE_B, title: "Setup" }),
        doc({ documentId: "in-a", sourceId: SOURCE_A, title: "Setup" }),
      ]);
      expect(resolver.resolve(wiki("Setup"), from({ sourceId: SOURCE_A }))).toEqual(resolved("in-a", 1));
      expect(resolver.resolve(wiki("Setup"), from({ sourceId: SOURCE_B }))).toEqual(resolved("in-b", 1));
    });

    it("prefers the spelling that matches exactly", () => {
      const resolver = buildLinkResolver([
        doc({ documentId: "lower", title: "notes" }),
        doc({ documentId: "upper", title: "Notes" }),
      ]);
      expect(resolver.resolve(wiki("Notes"), from())).toEqual(resolved("upper", 1));
      expect(resolver.resolve(wiki("notes"), from())).toEqual(resolved("lower", 1));
    });

    it("prefers a title match over a file-name-only match when both spell it exactly", () => {
      const resolver = buildLinkResolver([
        doc({ documentId: "by-file", title: "Something else", sourcePath: "Roadmap.md" }),
        doc({ documentId: "by-title", title: "Roadmap" }),
      ]);
      expect(resolver.resolve(wiki("Roadmap"), from())).toEqual(resolved("by-title", 1));
    });

    it("lets an exact spelling beat a title that only folds to it", () => {
      const resolver = buildLinkResolver([
        doc({ documentId: "by-file", title: "Something else", sourcePath: "roadmap.md" }),
        doc({ documentId: "by-title", title: "Roadmap" }),
      ]);
      expect(resolver.resolve(wiki("roadmap"), from())).toEqual(resolved("by-file", 1));
    });

    it("prefers the shallower path", () => {
      const resolver = buildLinkResolver([
        doc({ documentId: "deep", title: "Index", sourcePath: "a/b/c/index.md" }),
        doc({ documentId: "shallow", title: "Index", sourcePath: "index.md" }),
      ]);
      expect(resolver.resolve(wiki("Index"), from())).toEqual(resolved("shallow", 1));
    });

    it("falls back to the oldest, then the lowest id, whatever order the catalog arrives in", () => {
      const older = new Date("2026-01-01T00:00:00Z");
      const newer = new Date("2026-06-01T00:00:00Z");
      const catalog = [
        doc({ documentId: "z", title: "Same", createdAt: older }),
        doc({ documentId: "a", title: "Same", createdAt: older }),
        doc({ documentId: "m", title: "Same", createdAt: newer }),
      ];
      const forward = buildLinkResolver(catalog).resolve(wiki("Same"), from());
      const backward = buildLinkResolver([...catalog].reverse()).resolve(wiki("Same"), from());
      expect(forward).toEqual(resolved("a", 2));
      expect(backward).toEqual(forward);
    });

    it("counts a document matching by both title and file name once", () => {
      const resolver = buildLinkResolver([doc({ documentId: "d1", title: "Roadmap", sourcePath: "Roadmap.md" })]);
      expect(resolver.resolve(wiki("roadmap"), from())).toEqual(resolved("d1", 0));
    });
  });

  it("can resolve to the origin itself", () => {
    const resolver = buildLinkResolver([doc({ documentId: "origin", title: "Me" })]);
    expect(resolver.resolve(wiki("Me"), from({ documentId: "origin" }))).toEqual(resolved("origin"));
  });
});

describe("relative Markdown links", () => {
  const catalog = [
    doc({ documentId: "root", title: "Root", sourcePath: "root.md" }),
    doc({ documentId: "sibling", title: "Sibling", sourcePath: "notes/sibling.md" }),
    doc({ documentId: "parent", title: "Parent", sourcePath: "parent.md" }),
    doc({ documentId: "cased", title: "Cased", sourcePath: "Notes/Cased.md" }),
    doc({ documentId: "other-source", sourceId: SOURCE_B, title: "Elsewhere", sourcePath: "notes/elsewhere.md" }),
  ];
  const resolver = buildLinkResolver(catalog);
  const origin = from({ documentId: "me", sourcePath: "notes/me.md" });

  it("resolves from the directory of the origin", () => {
    expect(resolver.resolve(path("sibling.md"), origin)).toEqual(resolved("sibling"));
    expect(resolver.resolve(path("./sibling.md"), origin)).toEqual(resolved("sibling"));
    expect(resolver.resolve(path("../parent.md"), origin)).toEqual(resolved("parent"));
    expect(resolver.resolve(path("/root.md"), origin)).toEqual(resolved("root"));
  });

  it("falls back to a case-insensitive match", () => {
    expect(resolver.resolve(path("cased.md"), origin)).toEqual(resolved("cased"));
    expect(resolver.resolve(path("../notes/cased.md"), from({ sourcePath: "x/me.md" }))).toEqual(resolved("cased"));
    expect(resolver.resolve(path("/notes/cased.md"), origin)).toEqual(resolved("cased"));
  });

  it("prefers the exact path over one that only matches ignoring case", () => {
    const both = buildLinkResolver([
      doc({ documentId: "upper", title: "Upper", sourcePath: "a/B.md" }),
      doc({ documentId: "lower", title: "Lower", sourcePath: "a/b.md" }),
    ]);
    expect(both.resolve(path("b.md"), from({ sourcePath: "a/x.md" }))).toEqual(resolved("lower"));
    expect(both.resolve(path("B.md"), from({ sourcePath: "a/x.md" }))).toEqual(resolved("upper"));
  });

  it("stays inside the origin's source", () => {
    expect(resolver.resolve(path("elsewhere.md"), origin)).toEqual(unresolved);
    expect(resolver.resolve(path("elsewhere.md"), from({ sourceId: SOURCE_B, sourcePath: "notes/me.md" }))).toEqual(resolved("other-source"));
  });

  it("cannot be resolved from a document that has no path", () => {
    expect(resolver.resolve(path("sibling.md"), from({ sourcePath: null }))).toEqual(unresolved);
  });

  it("is unresolved when it climbs out of the source or names nothing", () => {
    expect(resolver.resolve(path("../../x.md"), origin)).toEqual(unresolved);
    expect(resolver.resolve(path("missing.md"), origin)).toEqual(unresolved);
  });
});
