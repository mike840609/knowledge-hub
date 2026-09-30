import { describe, expect, it } from "vitest";
import { clearDraft, draftStorageKey, readDraft, syncDraft, type DraftKey, type DraftStorage } from "@/lib/document-draft";

function memoryStorage(): DraftStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

const refusing: DraftStorage = {
  getItem: () => { throw new Error("SecurityError"); },
  setItem: () => { throw new Error("QuotaExceededError"); },
  removeItem: () => { throw new Error("SecurityError"); },
};

const edit: DraftKey = { kind: "edit", userId: "user-1", documentId: "doc-1" };
const create: DraftKey = { kind: "new", userId: "user-1", workspaceId: "ws-1" };
const initial = { title: "Saved", markdown: "saved body" };

describe("draftStorageKey", () => {
  it("names edit and new drafts apart", () => {
    expect(draftStorageKey(edit)).toBe("kh:draft:edit:user-1:doc-1");
    expect(draftStorageKey(create)).toBe("kh:draft:new:user-1:ws-1");
  });

  it("keeps one user's drafts from standing in for another's", () => {
    const mine: DraftKey = { kind: "edit", userId: "user-1", documentId: "doc-1" };
    const theirs: DraftKey = { kind: "edit", userId: "user-2", documentId: "doc-1" };
    expect(draftStorageKey(mine)).not.toBe(draftStorageKey(theirs));
    const storage = memoryStorage();
    syncDraft(storage, mine, { title: "Mine", markdown: "mine", baseRevisionId: "rev-1" }, initial);
    expect(readDraft(storage, theirs)).toBeNull();
    syncDraft(storage, theirs, { title: "Theirs", markdown: "theirs", baseRevisionId: "rev-1" }, initial);
    expect(readDraft(storage, mine)?.title).toBe("Mine");
  });

  it("gives a document started from a broken link's title a draft of its own, and one for each title", () => {
    const seeded: DraftKey = { kind: "new", userId: "user-1", workspaceId: "ws-1", title: "Kubernetes & more" };
    expect(draftStorageKey(seeded)).toBe("kh:draft:new:user-1:ws-1:Kubernetes%20%26%20more");
    expect(draftStorageKey(seeded)).not.toBe(draftStorageKey(create));
    expect(draftStorageKey({ kind: "new", userId: "user-1", workspaceId: "ws-1", title: "Other" })).not.toBe(draftStorageKey(seeded));
    // The blank form's draft is not what a seeded form restores, nor the other way round.
    const storage = memoryStorage();
    syncDraft(storage, create, { title: "Typed", markdown: "body", baseRevisionId: null }, { title: "", markdown: "" });
    expect(readDraft(storage, seeded)).toBeNull();
    syncDraft(storage, seeded, { title: "Kubernetes & more", markdown: "notes", baseRevisionId: null }, { title: "Kubernetes & more", markdown: "" });
    expect(readDraft(storage, create)).toEqual({ title: "Typed", markdown: "body", baseRevisionId: null });
    expect(readDraft(storage, seeded)).toEqual({ title: "Kubernetes & more", markdown: "notes", baseRevisionId: null });
  });
});

describe("syncDraft and readDraft", () => {
  it("keeps a draft that differs from what the composer opened with", () => {
    const storage = memoryStorage();
    syncDraft(storage, edit, { title: "Saved", markdown: "changed", baseRevisionId: "rev-1" }, initial);
    expect(readDraft(storage, edit)).toEqual({ title: "Saved", markdown: "changed", baseRevisionId: "rev-1" });
  });

  it("removes the draft once it matches what the composer opened with again", () => {
    const storage = memoryStorage();
    syncDraft(storage, edit, { title: "Saved", markdown: "changed", baseRevisionId: "rev-1" }, initial);
    syncDraft(storage, edit, { title: "Saved", markdown: "saved body", baseRevisionId: "rev-1" }, initial);
    expect(storage.map.size).toBe(0);
    expect(readDraft(storage, edit)).toBeNull();
  });

  it("keeps edit and new drafts from overwriting each other", () => {
    const storage = memoryStorage();
    syncDraft(storage, edit, { title: "A", markdown: "a", baseRevisionId: "rev-1" }, initial);
    syncDraft(storage, create, { title: "B", markdown: "b", baseRevisionId: null }, { title: "", markdown: "" });
    expect(readDraft(storage, edit)?.title).toBe("A");
    expect(readDraft(storage, create)).toEqual({ title: "B", markdown: "b", baseRevisionId: null });
  });

  it("reads nothing from a missing, corrupt, foreign-version or wrong-shaped entry", () => {
    const storage = memoryStorage();
    expect(readDraft(storage, edit)).toBeNull();
    storage.map.set("kh:draft:edit:user-1:doc-1", "{not json");
    expect(readDraft(storage, edit)).toBeNull();
    storage.map.set("kh:draft:edit:user-1:doc-1", JSON.stringify({ v: 2, title: "t", markdown: "m", baseRevisionId: null }));
    expect(readDraft(storage, edit)).toBeNull();
    storage.map.set("kh:draft:edit:user-1:doc-1", JSON.stringify({ v: 1, title: 7, markdown: "m", baseRevisionId: null }));
    expect(readDraft(storage, edit)).toBeNull();
    storage.map.set("kh:draft:edit:user-1:doc-1", "null");
    expect(readDraft(storage, edit)).toBeNull();
  });
});

describe("a storage that refuses", () => {
  it("never throws and reads as no draft", () => {
    const draft = { title: "t", markdown: "m", baseRevisionId: null };
    expect(() => syncDraft(refusing, edit, draft, initial)).not.toThrow();
    expect(() => syncDraft(refusing, edit, { ...draft, ...initial }, initial)).not.toThrow();
    expect(() => clearDraft(refusing, edit)).not.toThrow();
    expect(readDraft(refusing, edit)).toBeNull();
  });

  it("treats no storage at all the same way", () => {
    expect(() => syncDraft(null, edit, { title: "t", markdown: "m", baseRevisionId: null }, initial)).not.toThrow();
    expect(readDraft(null, edit)).toBeNull();
  });
});

describe("clearDraft", () => {
  it("removes only the named draft", () => {
    const storage = memoryStorage();
    syncDraft(storage, edit, { title: "A", markdown: "a", baseRevisionId: "rev-1" }, initial);
    syncDraft(storage, create, { title: "B", markdown: "b", baseRevisionId: null }, { title: "", markdown: "" });
    clearDraft(storage, edit);
    expect(readDraft(storage, edit)).toBeNull();
    expect(readDraft(storage, create)?.title).toBe("B");
  });
});
