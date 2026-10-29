import { describe, expect, it } from "vitest";
import { documentReachesFolder, linkOpens } from "@/modules/knowledge/application/internal/folder-link-reach";
import type { WorkspaceRole } from "@/modules/workspaces/domain/workspace-membership";

const NOW = new Date("2026-10-29T09:00:00Z");
const LINK: { revokedAt: Date | null; expiresAt: Date; createdBy: string } = { revokedAt: null, expiresAt: new Date("2026-11-28T09:00:00Z"), createdBy: "owner" };
const SOURCE: { status: "ACTIVE" | "ARCHIVED" } = { status: "ACTIVE" };
const WORKSPACE = { lifecycleState: "ACTIVE" as "ACTIVE" | "ARCHIVED" | null, personalOwnerUserId: "owner" as string | null };

function opens(overrides: {
  link?: Partial<typeof LINK>;
  target?: "ACTIVE" | "ARCHIVED";
  source?: Partial<typeof SOURCE>;
  workspace?: Partial<typeof WORKSPACE>;
  role?: WorkspaceRole | null;
  now?: Date;
} = {}) {
  return linkOpens(
    { ...LINK, ...overrides.link },
    overrides.target ?? "ACTIVE",
    { ...SOURCE, ...overrides.source },
    { ...WORKSPACE, ...overrides.workspace },
    "role" in overrides ? overrides.role : "VIEWER",
    overrides.now ?? NOW,
  );
}

/** The one judgement every reader and writer shares: page reads, `/open`, writes and the followed list. */
describe("linkOpens", () => {
  it("opens a live link that its owner still directly reaches", () => {
    expect(opens()).toBe(true);
  });

  it("refuses a revoked or expired link, an archived target, Source or Workspace, a creator who no longer owns it, and no direct membership", () => {
    expect(opens({ link: { revokedAt: NOW } })).toBe(false);
    expect(opens({ link: { expiresAt: NOW } })).toBe(false);
    expect(opens({ target: "ARCHIVED" })).toBe(false);
    expect(opens({ source: { status: "ARCHIVED" } })).toBe(false);
    expect(opens({ workspace: { lifecycleState: "ARCHIVED" } })).toBe(false);
    expect(opens({ workspace: { personalOwnerUserId: "someone-else" } })).toBe(false);
    expect(opens({ role: undefined })).toBe(false);
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
