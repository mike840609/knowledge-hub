import { describe, expect, it } from "vitest";
import {
  assertShareLinkCreation,
  evaluateShareLinkValidity,
  isShareToken,
  shareLinkExpiry,
  type ShareLinkCreationInput,
  type ShareLinkValidityInput,
} from "@/modules/knowledge/domain/document-share-link";

const now = new Date("2026-09-23T00:00:00Z");
const later = new Date("2026-10-01T00:00:00Z");

function validity(overrides: Partial<ShareLinkValidityInput> = {}): ShareLinkValidityInput {
  return {
    link: { revokedAt: null, expiresAt: later },
    documentStatus: "ACTIVE",
    sourceStatus: "ACTIVE",
    workspaceLifecycle: "ACTIVE",
    creatorDirectRole: "OWNER",
    now,
    ...overrides,
  };
}

describe("evaluateShareLinkValidity (share-link spec §5.2)", () => {
  it("is valid when every condition holds", () => {
    expect(evaluateShareLinkValidity(validity())).toEqual({ valid: true });
  });

  it.each([
    ["REVOKED", { link: { revokedAt: now, expiresAt: later } }],
    ["EXPIRED", { link: { revokedAt: null, expiresAt: now } }],
    ["DOCUMENT_ARCHIVED", { documentStatus: "ARCHIVED" }],
    ["SOURCE_ARCHIVED", { sourceStatus: "ARCHIVED" }],
    ["WORKSPACE_ARCHIVED", { workspaceLifecycle: "ARCHIVED" }],
    ["CREATOR_LOST_ACCESS", { creatorDirectRole: undefined }],
  ] as const)("fails with %s when only that condition fails", (reason, overrides) => {
    expect(evaluateShareLinkValidity(validity(overrides as Partial<ShareLinkValidityInput>))).toEqual({ valid: false, reason });
  });

  it("treats a legacy membership row with no role as still able to read", () => {
    expect(evaluateShareLinkValidity(validity({ creatorDirectRole: null }))).toEqual({ valid: true });
  });
});

function creation(overrides: Partial<ShareLinkCreationInput> = {}): ShareLinkCreationInput {
  return {
    callerId: "owner",
    documentStatus: "ACTIVE",
    sourceStatus: "ACTIVE",
    workspace: { workspaceType: "PERSONAL", personalOwnerUserId: "owner", lifecycleState: "ACTIVE" },
    activeLinkCount: 0,
    expiresInDays: undefined,
    label: undefined,
    ...overrides,
  };
}

describe("assertShareLinkCreation (share-link spec §5.1)", () => {
  it("defaults expiry to 30 days and a blank label to null", () => {
    expect(assertShareLinkCreation(creation({ label: "   " }))).toEqual({ expiresInDays: 30, label: null });
  });

  it("keeps a trimmed label and an allowed expiry", () => {
    expect(assertShareLinkCreation(creation({ label: " backend team ", expiresInDays: 7 }))).toEqual({ expiresInDays: 7, label: "backend team" });
  });

  it("rejects a Team document", () => {
    expect(() => assertShareLinkCreation(creation({ workspace: { workspaceType: "TEAM", personalOwnerUserId: null, lifecycleState: "ACTIVE" } })))
      .toThrow(expect.objectContaining({ code: "SHARE_LINK_NOT_PERSONAL" }));
  });

  it("hides another user's My Space document as not found", () => {
    expect(() => assertShareLinkCreation(creation({ callerId: "someone-else" })))
      .toThrow(expect.objectContaining({ code: "DOCUMENT_NOT_FOUND" }));
  });

  it("rejects the eleventh active link", () => {
    expect(() => assertShareLinkCreation(creation({ activeLinkCount: 9 }))).not.toThrow();
    expect(() => assertShareLinkCreation(creation({ activeLinkCount: 10 })))
      .toThrow(expect.objectContaining({ code: "SHARE_LINK_LIMIT_REACHED" }));
  });

  it.each([0, 2, 365, "30", null])("rejects expiry %j", (expiresInDays) => {
    expect(() => assertShareLinkCreation(creation({ expiresInDays })))
      .toThrow(expect.objectContaining({ code: "INVALID_SHARE_LINK_EXPIRY" }));
  });

  it("rejects a label over 200 characters or that is not text", () => {
    expect(() => assertShareLinkCreation(creation({ label: "x".repeat(200) }))).not.toThrow();
    expect(() => assertShareLinkCreation(creation({ label: "x".repeat(201) })))
      .toThrow(expect.objectContaining({ code: "INVALID_SHARE_LINK_LABEL" }));
    expect(() => assertShareLinkCreation(creation({ label: 42 })))
      .toThrow(expect.objectContaining({ code: "INVALID_SHARE_LINK_LABEL" }));
  });

  it("rejects archived documents, sources and workspaces", () => {
    expect(() => assertShareLinkCreation(creation({ documentStatus: "ARCHIVED" }))).toThrow(expect.objectContaining({ code: "DOCUMENT_ARCHIVED" }));
    expect(() => assertShareLinkCreation(creation({ sourceStatus: "ARCHIVED" }))).toThrow(expect.objectContaining({ code: "SOURCE_ARCHIVED" }));
    expect(() => assertShareLinkCreation(creation({ workspace: { workspaceType: "PERSONAL", personalOwnerUserId: "owner", lifecycleState: "ARCHIVED" } })))
      .toThrow(expect.objectContaining({ code: "WORKSPACE_ARCHIVED" }));
  });
});

describe("share tokens", () => {
  it("accepts only UUIDv4", () => {
    expect(isShareToken("3b241101-e2bb-4255-8caf-4136c566a962")).toBe(true);
    expect(isShareToken("01a0cdb5-9d1b-70a3-93e0-43bbf50ed31f")).toBe(false);
    expect(isShareToken("not-a-token")).toBe(false);
    expect(isShareToken("")).toBe(false);
  });

  it("computes expiry in whole days from creation", () => {
    expect(shareLinkExpiry(now, 7).toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });
});
