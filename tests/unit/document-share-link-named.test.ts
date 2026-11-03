import { describe, expect, it } from "vitest";
import { DomainError } from "@/modules/knowledge/domain/errors";
import {
  MAX_NAMED_SHARE_RECIPIENTS,
  evaluateShareLinkValidity,
  normalizeRecipients,
  type ShareLinkValidityInput,
} from "@/modules/knowledge/domain/document-share-link";

const OWNER = "018f0000-0000-7000-8000-000000000001";
const NOW = new Date("2026-11-03T00:00:00Z");

function validity(overrides: Partial<ShareLinkValidityInput["link"]> = {}): ShareLinkValidityInput {
  return {
    link: { revokedAt: null, expiresAt: null, createdBy: OWNER, ...overrides },
    documentStatus: "ACTIVE",
    sourceStatus: "ACTIVE",
    workspaceLifecycle: "ACTIVE",
    workspaceOwnerUserId: OWNER,
    creatorDirectRole: null,
    now: NOW,
  };
}

describe("evaluateShareLinkValidity with a NAMED link (no expiry)", () => {
  it("never yields EXPIRED for a null expiresAt", () => {
    expect(evaluateShareLinkValidity(validity())).toEqual({ valid: true });
  });

  it("still yields REVOKED for a revoked link", () => {
    expect(evaluateShareLinkValidity(validity({ revokedAt: new Date("2026-11-02T00:00:00Z") }))).toEqual({ valid: false, reason: "REVOKED" });
  });

  it("still expires a link that has an expiry in the past", () => {
    expect(evaluateShareLinkValidity(validity({ expiresAt: new Date("2026-11-02T00:00:00Z") }))).toEqual({ valid: false, reason: "EXPIRED" });
  });
});

describe("normalizeRecipients", () => {
  const ctx = { ownerId: OWNER };
  const upper = "A0B1C2D3-0000-7000-8000-00000000000A";

  it("lower-cases and de-duplicates ids", () => {
    expect(normalizeRecipients([upper, upper.toLowerCase()], ctx)).toEqual([upper.toLowerCase()]);
  });

  it("accepts exactly the maximum number of recipients", () => {
    const ids = Array.from({ length: MAX_NAMED_SHARE_RECIPIENTS }, (_, i) => `018f0000-0000-7000-8000-${String(i + 100).padStart(12, "0")}`);
    expect(normalizeRecipients(ids, ctx)).toHaveLength(MAX_NAMED_SHARE_RECIPIENTS);
  });

  it.each([
    ["an empty list", []],
    ["the owner", [OWNER]],
    ["the owner in other case", [OWNER.toUpperCase()]],
    ["a non-UUID entry", ["x"]],
    ["a non-string entry", [42]],
    ["a non-array", "id"],
    ["undefined", undefined],
  ])("rejects %s with INVALID_REQUEST", (_name, raw) => {
    expect(() => normalizeRecipients(raw, ctx)).toThrow(DomainError);
    try { normalizeRecipients(raw, ctx); } catch (error) { expect((error as DomainError).code).toBe("INVALID_REQUEST"); }
  });

  it("rejects more than the maximum number of distinct recipients", () => {
    const ids = Array.from({ length: MAX_NAMED_SHARE_RECIPIENTS + 1 }, (_, i) => `018f0000-0000-7000-8000-${String(i + 100).padStart(12, "0")}`);
    expect(() => normalizeRecipients(ids, ctx)).toThrow(DomainError);
  });
});
