import { describe, expect, it } from "vitest";
import { CONTINUE_LIMIT, continueItems, type ContinueDoc, type ContinueDraft } from "@/lib/home-continue";

const doc = (id: string, over: Partial<ContinueDoc> = {}): ContinueDoc => ({
  documentId: id, sourceId: "src", title: id, updatedAt: "2026-10-01T00:00:00.000Z",
  ownership: "HUB_MANAGED", status: "ACTIVE", sourceStatus: "ACTIVE", ...over,
});
const draft = (key: string, updatedAt: string): ContinueDraft => ({ key, title: key, sourceId: key === "draft:new" ? null : "src", updatedAt });
const ids = (items: { id: string; label: string }[]) => items.map(i => `${i.label}:${i.id}`);

describe("continueItems", () => {
  it("returns nothing for empty inputs", () => {
    expect(continueItems({ documents: [], drafts: [], recent: [] })).toEqual([]);
  });

  it("lists Hub-managed documents as Edited, newest first", () => {
    const documents = [doc("a", { updatedAt: "2026-10-01T00:00:00.000Z" }), doc("b", { updatedAt: "2026-10-03T00:00:00.000Z" })];
    expect(ids(continueItems({ documents, drafts: [], recent: [] }))).toEqual(["Edited:b", "Edited:a"]);
  });

  it("never lists a source-managed document as Edited, only as Opened", () => {
    const documents = [doc("s", { ownership: "SOURCE_MANAGED", updatedAt: "2026-10-09T00:00:00.000Z" })];
    expect(continueItems({ documents, drafts: [], recent: [] })).toEqual([]);
    const opened = continueItems({ documents, drafts: [], recent: ["src:s"], openedAt: { "src:s": "2026-10-02T00:00:00.000Z" } });
    expect(ids(opened)).toEqual(["Opened:s"]);
    expect(opened[0].at).toBe("2026-10-02T00:00:00.000Z");
  });

  it("keeps one row per document, labelled by its newest event", () => {
    const documents = [doc("a", { updatedAt: "2026-10-01T00:00:00.000Z" })];
    const items = continueItems({ documents, drafts: [], recent: ["src:a"], openedAt: { "src:a": "2026-10-05T00:00:00.000Z" } });
    expect(ids(items)).toEqual(["Opened:a"]);
  });

  it("lets a draft win over a newer edit or open of the same document", () => {
    const documents = [doc("a", { updatedAt: "2026-10-09T00:00:00.000Z" })];
    const items = continueItems({ documents, drafts: [draft("draft:a", "2026-10-01T00:00:00.000Z")], recent: ["src:a"], openedAt: { "src:a": "2026-10-08T00:00:00.000Z" } });
    expect(ids(items)).toEqual(["Draft:a"]);
    expect(items[0].doc?.documentId).toBe("a");
    expect(items[0].at).toBe("2026-10-01T00:00:00.000Z");
  });

  it("keeps the new-note draft, which has no document", () => {
    const items = continueItems({ documents: [], drafts: [draft("draft:new", "2026-10-01T00:00:00.000Z")], recent: [] });
    expect(ids(items)).toEqual(["Draft:draft:new"]);
    expect(items[0].doc).toBeUndefined();
  });

  it("excludes archived documents and documents in archived sources, whichever input names them", () => {
    const documents = [doc("a", { status: "ARCHIVED" }), doc("b", { sourceStatus: "ARCHIVED" })];
    const items = continueItems({ documents, drafts: [draft("draft:a", "2026-10-01T00:00:00.000Z")], recent: ["src:b"], openedAt: { "src:b": "2026-10-01T00:00:00.000Z" } });
    expect(items).toEqual([]);
  });

  it("excludes a draft or recent whose document is not in the workspace", () => {
    const items = continueItems({ documents: [], drafts: [draft("draft:gone", "2026-10-01T00:00:00.000Z")], recent: ["src:gone"], openedAt: { "src:gone": "2026-10-01T00:00:00.000Z" } });
    expect(items).toEqual([]);
  });

  it("puts recents without an open time after timed rows, in recents order", () => {
    const documents = [doc("x", { ownership: "SOURCE_MANAGED" }), doc("y", { ownership: "SOURCE_MANAGED" }), doc("e", { updatedAt: "2026-01-01T00:00:00.000Z" })];
    expect(ids(continueItems({ documents, drafts: [], recent: ["src:y", "src:x"] }))).toEqual(["Edited:e", "Opened:y", "Opened:x"]);
  });

  it(`caps the list at ${CONTINUE_LIMIT} rows`, () => {
    const documents = Array.from({ length: 12 }, (_, n) => doc(`d${n}`, { updatedAt: `2026-10-${String(n + 1).padStart(2, "0")}T00:00:00.000Z` }));
    const items = continueItems({ documents, drafts: [], recent: [] });
    expect(items).toHaveLength(CONTINUE_LIMIT);
    expect(items[0].id).toBe("d11");
  });
});
