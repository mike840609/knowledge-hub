import { describe, expect, it } from "vitest";
import { RECENT_LIMIT, homeLists, type ContinueDoc, type ContinueDraft } from "@/lib/home-continue";

const doc = (id: string, over: Partial<ContinueDoc> = {}): ContinueDoc => ({
  documentId: id, sourceId: "src", title: id, updatedAt: "2026-10-01T00:00:00.000Z",
  ownership: "HUB_MANAGED", status: "ACTIVE", sourceStatus: "ACTIVE", ...over,
});
const draft = (key: string, updatedAt: string): ContinueDraft => ({ key, title: key, sourceId: key === "draft:new" ? null : "src", updatedAt });
const ids = (items: { id: string; label: string }[]) => items.map(i => `${i.label}:${i.id}`);

describe("homeLists", () => {
  it("returns nothing for empty inputs", () => {
    expect(homeLists({ documents: [], drafts: [], recent: [] })).toEqual({ drafts: [], recent: [] });
  });

  it("lists Hub-managed documents as Edited, newest first", () => {
    const documents = [doc("a", { updatedAt: "2026-10-01T00:00:00.000Z" }), doc("b", { updatedAt: "2026-10-03T00:00:00.000Z" })];
    expect(ids(homeLists({ documents, drafts: [], recent: [] }).recent)).toEqual(["Edited:b", "Edited:a"]);
  });

  it("never lists a source-managed document as Edited, only as Opened", () => {
    const documents = [doc("s", { ownership: "SOURCE_MANAGED", updatedAt: "2026-10-09T00:00:00.000Z" })];
    expect(homeLists({ documents, drafts: [], recent: [] }).recent).toEqual([]);
    const { recent } = homeLists({ documents, drafts: [], recent: ["src:s"], openedAt: { "src:s": "2026-10-02T00:00:00.000Z" } });
    expect(ids(recent)).toEqual(["Opened:s"]);
    expect(recent[0].at).toBe("2026-10-02T00:00:00.000Z");
  });

  it("keeps one recent row per document, labelled by its newest event", () => {
    const documents = [doc("a", { updatedAt: "2026-10-05T00:00:00.000Z" }), doc("b", { updatedAt: "2026-10-01T00:00:00.000Z" })];
    const { recent } = homeLists({ documents, drafts: [], recent: ["src:a", "src:b"], openedAt: { "src:a": "2026-10-02T00:00:00.000Z", "src:b": "2026-10-03T00:00:00.000Z" } });
    expect(ids(recent)).toEqual(["Edited:a", "Opened:b"]);
  });

  it("lists every draft newest first, however old, apart from recent rows", () => {
    const documents = [doc("a"), doc("e", { updatedAt: "2026-10-09T00:00:00.000Z" })];
    const lists = homeLists({ documents, drafts: [draft("draft:a", "2026-01-01T00:00:00.000Z"), draft("draft:new", "2026-02-01T00:00:00.000Z")], recent: [] });
    expect(lists.drafts.map(d => d.id)).toEqual(["draft:new", "a"]);
    expect(lists.drafts[1].doc?.documentId).toBe("a");
    expect(lists.drafts[0].doc).toBeUndefined();
    expect(ids(lists.recent)).toEqual(["Edited:e"]);
  });

  it("shows a document with a draft only under drafts, not again in recent", () => {
    const documents = [doc("a", { updatedAt: "2026-10-09T00:00:00.000Z" })];
    const lists = homeLists({ documents, drafts: [draft("draft:a", "2026-10-01T00:00:00.000Z")], recent: ["src:a"], openedAt: { "src:a": "2026-10-08T00:00:00.000Z" } });
    expect(lists.drafts.map(d => d.id)).toEqual(["a"]);
    expect(lists.recent).toEqual([]);
  });

  it("excludes archived documents and documents in archived sources, whichever input names them", () => {
    const documents = [doc("a", { status: "ARCHIVED" }), doc("b", { sourceStatus: "ARCHIVED" })];
    const lists = homeLists({ documents, drafts: [draft("draft:a", "2026-10-01T00:00:00.000Z")], recent: ["src:b"], openedAt: { "src:b": "2026-10-01T00:00:00.000Z" } });
    expect(lists).toEqual({ drafts: [], recent: [] });
  });

  it("excludes a draft or recent whose document is not in the workspace", () => {
    const lists = homeLists({ documents: [], drafts: [draft("draft:gone", "2026-10-01T00:00:00.000Z")], recent: ["src:gone"], openedAt: { "src:gone": "2026-10-01T00:00:00.000Z" } });
    expect(lists).toEqual({ drafts: [], recent: [] });
  });

  it("puts recents without an open time after timed rows, in recents order", () => {
    const documents = [doc("x", { ownership: "SOURCE_MANAGED" }), doc("y", { ownership: "SOURCE_MANAGED" }), doc("e", { updatedAt: "2026-01-01T00:00:00.000Z" })];
    expect(ids(homeLists({ documents, drafts: [], recent: ["src:y", "src:x"] }).recent)).toEqual(["Edited:e", "Opened:y", "Opened:x"]);
  });

  it(`keeps at most ${RECENT_LIMIT} recent rows, newest first`, () => {
    const documents = Array.from({ length: 20 }, (_, n) => doc(`d${n}`, { updatedAt: `2026-10-${String(n + 1).padStart(2, "0")}T00:00:00.000Z` }));
    const { recent } = homeLists({ documents, drafts: [], recent: [] });
    expect(recent).toHaveLength(RECENT_LIMIT);
    expect(recent[0].id).toBe("d19");
  });
});
