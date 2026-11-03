import { describe, expect, it } from "vitest";
import { documentReachesFolder, linkOpensFor } from "@/modules/knowledge/application/internal/folder-link-reach";
import type { DocumentShareLink } from "@/modules/knowledge/domain/document-share-link";
import type { KnowledgeRepositories } from "@/modules/knowledge/ports/unit-of-work";
import type { WorkspaceRole } from "@/modules/workspaces/domain/workspace-membership";

const NOW = new Date("2026-10-29T09:00:00Z");
const OWNER = "0199f300-0000-7000-8000-0000000000a1";
const RECIPIENT = "0199f300-0000-7000-8000-0000000000a2";
const LINK = { id: "link", audience: "LINK", revokedAt: null, expiresAt: new Date("2026-11-28T09:00:00Z"), createdBy: OWNER } as unknown as DocumentShareLink;
const SOURCE: { status: "ACTIVE" | "ARCHIVED" } = { status: "ACTIVE" };
const WORKSPACE = { id: "ws", lifecycleState: "ACTIVE" as "ACTIVE" | "ARCHIVED" | null, personalOwnerUserId: OWNER as string | null };

function opens(overrides: {
  link?: Partial<DocumentShareLink>;
  target?: "ACTIVE" | "ARCHIVED";
  source?: Partial<typeof SOURCE>;
  workspace?: Partial<typeof WORKSPACE>;
  role?: WorkspaceRole | null;
  now?: Date;
  viewer?: string | null;
} = {}) {
  const role = "role" in overrides ? overrides.role : "VIEWER";
  const r = {
    workspaceMemberships: { find: async () => (role === undefined ? null : { role }) },
    shareLinks: { isRecipient: async (_link: string, user: string) => user === RECIPIENT },
  } as unknown as KnowledgeRepositories;
  return linkOpensFor(
    r,
    { ...LINK, ...overrides.link } as DocumentShareLink,
    overrides.target ?? "ACTIVE",
    { ...SOURCE, ...overrides.source },
    { ...WORKSPACE, ...overrides.workspace },
    overrides.now ?? NOW,
    overrides.viewer === undefined ? null : overrides.viewer,
  );
}

/** The one judgement every reader and writer shares: page reads, `/open`, writes and the followed list. */
describe("linkOpensFor", () => {
  it("opens a live link that its owner still directly reaches", async () => {
    expect(await opens()).toBe(true);
  });

  it("refuses a revoked or expired link, an archived target, Source or Workspace, a creator who no longer owns it, and no direct membership", async () => {
    expect(await opens({ link: { revokedAt: NOW } })).toBe(false);
    expect(await opens({ link: { expiresAt: NOW } })).toBe(false);
    expect(await opens({ target: "ARCHIVED" })).toBe(false);
    expect(await opens({ source: { status: "ARCHIVED" } })).toBe(false);
    expect(await opens({ workspace: { lifecycleState: "ARCHIVED" } })).toBe(false);
    expect(await opens({ workspace: { personalOwnerUserId: "someone-else" } })).toBe(false);
    expect(await opens({ role: undefined })).toBe(false);
  });

  it("asks a NAMED link's audience first: only a recipient or the owner, never no one signed in", async () => {
    const named = { audience: "NAMED" } as Partial<DocumentShareLink>;
    expect(await opens({ link: named, viewer: RECIPIENT })).toBe(true);
    expect(await opens({ link: named, viewer: OWNER })).toBe(true);
    expect(await opens({ link: named, viewer: "0199f300-0000-7000-8000-0000000000a3" })).toBe(false);
    expect(await opens({ link: named, viewer: null })).toBe(false);
  });
});

describe("documentReachesFolder", () => {
  const folder = { id: "folder", nodeType: "FOLDER" as const, sourceId: "source" };
  const document = { sourceId: "source", status: "ACTIVE" as const };
  const chain = [
    { id: "node", parentId: "folder", nodeType: "DOCUMENT" as const, status: "ACTIVE" as const },
    { id: "folder", parentId: null, nodeType: "FOLDER" as const, status: "ACTIVE" as const },
  ];

  it("is true only for an ACTIVE document of the folder's Source whose chain reaches the folder", () => {
    expect(documentReachesFolder(folder, document, chain)).toBe(true);
    expect(documentReachesFolder(folder, { ...document, status: "ARCHIVED" }, chain)).toBe(false);
    expect(documentReachesFolder(folder, { ...document, sourceId: "other" }, chain)).toBe(false);
    expect(documentReachesFolder(folder, document, undefined)).toBe(false);
    expect(documentReachesFolder(folder, document, [{ ...chain[0], parentId: null }])).toBe(false);
    expect(documentReachesFolder(folder, document, [chain[0], { ...chain[1], status: "ARCHIVED" }])).toBe(false);
  });
});
