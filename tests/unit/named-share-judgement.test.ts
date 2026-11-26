import { describe, expect, it, vi } from "vitest";
import { judgeNamedShares, namedShareTitle, openNamedTarget } from "@/modules/knowledge/application/internal/named-share-judgement";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { DocumentShareLink, ShareLinkTarget } from "@/modules/knowledge/domain/document-share-link";
import type { KnowledgeRepositories } from "@/modules/knowledge/ports/unit-of-work";

const OWNER = "00000000-0000-4000-8000-000000000099";
const USER = "00000000-0000-4000-8000-000000000001";

/** A My Space world for one recipient: documents, a Source and Workspace, and unread named shares. */
function world() {
  const now = new Date("2026-11-26T00:00:00.000Z");
  const source = { id: "source", workspaceId: "workspace", name: "Source", sourceType: "HUB" as const, ownership: "HUB_MANAGED" as const, status: "ACTIVE" as "ACTIVE" | "ARCHIVED", syncVersion: 1 };
  const workspace = { id: "workspace", workspaceType: "PERSONAL", lifecycleState: "ACTIVE", personalOwnerUserId: OWNER };
  const documents = new Map([["doc", { id: "doc", sourceId: "source", status: "ACTIVE" as "ACTIVE" | "ARCHIVED" }]]);
  const unread: Array<{ link: DocumentShareLink; addedAt: Date; readAt: Date | null }> = [];
  const markRecipientRead = vi.fn(async (linkId: string) => {
    const index = unread.findIndex(row => row.link.id === linkId);
    if (index >= 0) unread.splice(index, 1);
  });
  const listUnreadForRecipient = vi.fn(async (_userId: string, limit: number, offset = 0) => unread.slice(offset, offset + limit));
  const r = {
    documents: { findById: vi.fn(async (id: string) => documents.get(id) ?? null) },
    sourcePolicy: { findById: vi.fn(async (id: string) => id === source.id ? source : null) },
    workspaces: { findById: vi.fn(async (id: string) => id === workspace.id ? workspace : null) },
    workspaceMemberships: { find: vi.fn(async () => ({ role: "OWNER" })) },
    tree: { findById: vi.fn(async () => null) },
    shareLinks: { listForRecipient: async () => unread, listUnreadForRecipient, markRecipientRead, isRecipient: vi.fn(async () => true) },
  } as unknown as KnowledgeRepositories;
  const add = (id: string, target: ShareLinkTarget, addedAt: Date, extra: Partial<DocumentShareLink> = {}) => {
    const link = { id, target, token: "token", label: null, audience: "NAMED", createdBy: OWNER, createdAt: new Date(0), expiresAt: null, revokedBy: null, revokedAt: null, ...extra } as DocumentShareLink;
    unread.push({ link, addedAt, readAt: null });
    return link;
  };
  return { now, r, documents, source, add, markRecipientRead, listUnreadForRecipient };
}

/** Two named shares, one already read; neither document exists, so each judgement is one document read. */
function repositories() {
  const addedAt = new Date(0);
  const rows = [
    { link: { target: { kind: "DOCUMENT", documentId: "read-doc" }, revokedAt: null, expiresAt: null }, addedAt, readAt: new Date(1) },
    { link: { target: { kind: "DOCUMENT", documentId: "unread-doc" }, revokedAt: null, expiresAt: null }, addedAt, readAt: null },
  ];
  const findById = vi.fn(async () => null);
  const markRecipientRead = vi.fn(async () => undefined);
  const shareLinks = { listForRecipient: async () => rows, listUnreadForRecipient: async () => rows.filter(row => row.readAt === null), markRecipientRead };
  const r = { shareLinks, documents: { findById } } as unknown as KnowledgeRepositories;
  return { r, findById, markRecipientRead };
}

describe("judging the shares that name a reader", () => {
  it("uses a Source name as its title", async () => {
    expect(await namedShareTitle({} as KnowledgeRepositories, {} as CallerContext, { sourceName: "Notes" })).toBe("Notes");
  });

  it("refuses a missing Source", async () => {
    const findById = vi.fn(async () => null);
    const r = { shareLinks: { isRecipient: async () => true }, sourcePolicy: { findById } } as unknown as KnowledgeRepositories;
    const link = { id: "link", audience: "NAMED", target: { kind: "SOURCE", sourceId: "missing" }, revokedAt: null, expiresAt: null } as DocumentShareLink;
    expect(await openNamedTarget(r, link, "00000000-0000-4000-8000-000000000001", new Date())).toBeNull();
    expect(findById).toHaveBeenCalledWith("missing");
  });
  it("the unread list and badge judge only the shares not yet read, and mark a dead one read", async () => {
    const { r, findById, markRecipientRead } = repositories();
    const now = new Date();
    expect(await judgeNamedShares(r, "u", 100, now, true)).toEqual([]);
    expect(findById.mock.calls).toEqual([["unread-doc"]]);
    expect(markRecipientRead).toHaveBeenCalledTimes(1);
    expect(markRecipientRead.mock.calls[0]).toEqual([undefined, "u", now]);
  });

  it("the activity view and Shares page still judge every share", async () => {
    const { r, findById } = repositories();
    expect(await judgeNamedShares(r, "u", 100, new Date())).toHaveLength(2);
    expect(findById.mock.calls).toEqual([["read-doc"], ["unread-doc"]]);
  });
});

describe("permanently dead and temporarily unreachable unread shares", () => {
  it("marks a revoked or expired unread share read", async () => {
    const w = world();
    w.add("revoked", { kind: "DOCUMENT", documentId: "doc" }, new Date(0), { revokedAt: new Date(1) });
    w.add("expired", { kind: "DOCUMENT", documentId: "doc" }, new Date(1), { expiresAt: new Date(0) });
    expect(await judgeNamedShares(w.r, USER, 100, w.now, true)).toEqual([]);
    expect(w.markRecipientRead.mock.calls.map(call => call[0]).sort()).toEqual(["expired", "revoked"]);
  });

  it("marks a share whose target row is missing read", async () => {
    const w = world();
    w.add("missing-document", { kind: "DOCUMENT", documentId: "gone" }, new Date(0));
    w.add("missing-source", { kind: "SOURCE", sourceId: "gone" }, new Date(1));
    w.add("missing-folder", { kind: "FOLDER", folderNodeId: "gone" }, new Date(2));
    expect(await judgeNamedShares(w.r, USER, 100, w.now, true)).toEqual([]);
    expect(w.markRecipientRead.mock.calls.map(call => call[0]).sort()).toEqual(["missing-document", "missing-folder", "missing-source"]);
  });

  it("leaves a share on a temporarily archived document unread, and returns it once restored", async () => {
    const w = world();
    w.documents.get("doc")!.status = "ARCHIVED";
    w.add("archived", { kind: "DOCUMENT", documentId: "doc" }, new Date(0));
    expect(await judgeNamedShares(w.r, USER, 100, w.now, true)).toEqual([]);
    expect(w.markRecipientRead).not.toHaveBeenCalled();
    w.documents.get("doc")!.status = "ACTIVE";
    expect((await judgeNamedShares(w.r, USER, 100, w.now, true)).map(row => row.target)).toEqual([{ documentId: "doc" }]);
  });

  it("leaves a share on a temporarily archived Source unread", async () => {
    const w = world();
    w.add("archived-source", { kind: "SOURCE", sourceId: "source" }, new Date(0));
    w.source.status = "ARCHIVED";
    expect(await judgeNamedShares(w.r, USER, 100, w.now, true)).toEqual([]);
    expect(w.markRecipientRead).not.toHaveBeenCalled();
  });

  it("pages past a temporarily unreachable share to an older live one", async () => {
    const w = world();
    w.documents.set("other", { id: "other", sourceId: "source", status: "ACTIVE" });
    w.documents.get("doc")!.status = "ARCHIVED";
    w.add("archived", { kind: "DOCUMENT", documentId: "doc" }, new Date(2));
    w.add("live", { kind: "DOCUMENT", documentId: "other" }, new Date(1));
    expect((await judgeNamedShares(w.r, USER, 1, w.now, true)).map(row => row.link.id)).toEqual(["live"]);
    expect(w.listUnreadForRecipient.mock.calls).toEqual([[USER, 1], [USER, 1, 1]]);
    expect(w.markRecipientRead).not.toHaveBeenCalled();
  });

  it("returns an older live share past a full page mixing dead and unreachable rows", async () => {
    const w = world();
    w.documents.get("doc")!.status = "ARCHIVED";
    w.documents.set("other", { id: "other", sourceId: "source", status: "ACTIVE" });
    // 40 permanently dead (revoked) rows, then 60 temporarily unreachable (archived) ones, then one older live share.
    for (let index = 0; index < 40; index += 1) {
      w.add(`revoked-${index}`, { kind: "DOCUMENT", documentId: "doc" }, new Date(2000 - index), { revokedAt: new Date(1) });
    }
    for (let index = 0; index < 60; index += 1) {
      w.add(`archived-${index}`, { kind: "DOCUMENT", documentId: "doc" }, new Date(1000 - index));
    }
    w.add("live", { kind: "DOCUMENT", documentId: "other" }, new Date(0));
    expect((await judgeNamedShares(w.r, USER, 100, w.now, true)).map(row => row.link.id)).toEqual(["live"]);
    // Only the 40 permanently dead shares are marked read; the archived ones keep their unread mark.
    expect(w.markRecipientRead).toHaveBeenCalledTimes(40);
    expect(w.listUnreadForRecipient.mock.calls).toEqual([[USER, 100], [USER, 100, 60]]);
  });
});
