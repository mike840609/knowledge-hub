import { describe, expect, it } from "vitest";
import { ValidationError } from "@/modules/knowledge/domain/errors";
import {
  normalizePublicationName,
  planPublicationMoves,
  publicationOverlap,
  relativePublicationPath,
  type PlannedMove,
  type PublicationDocument,
} from "@/modules/sources/domain/publication";

function heldDocument(id: string, sourcePath: string | null): PublicationDocument {
  return {
    teamDocumentId: id,
    publicationId: "publication-1",
    creatorContributionId: "contribution-1",
    currentOriginalDocumentId: `original-${id}`,
    sourcePath,
    status: "ACTIVE",
  };
}

function heldOf(...documents: PublicationDocument[]): ReadonlyMap<string, PublicationDocument> {
  return new Map(documents.map((document) => [document.teamDocumentId, document]));
}

function pathsOf(moves: readonly PlannedMove[]): Record<string, string | null> {
  return Object.fromEntries(moves.map((move) => [move.teamDocumentId, move.toPath]));
}

describe("normalizePublicationName", () => {
  it("trims surrounding whitespace and keeps the inner text", () => {
    expect(normalizePublicationName("  HCM KM 設計  ")).toBe("HCM KM 設計");
  });

  it("does not add a suffix to a name that is already taken", () => {
    expect(normalizePublicationName("Payroll")).toBe("Payroll");
  });

  it("accepts a name at the 512 character limit", () => {
    expect(normalizePublicationName("x".repeat(512))).toHaveLength(512);
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(() => normalizePublicationName("")).toThrow(ValidationError);
    expect(() => normalizePublicationName("   ")).toThrow(ValidationError);
  });

  it("rejects a name longer than 512 characters", () => {
    expect(() => normalizePublicationName("x".repeat(513))).toThrow(ValidationError);
  });
});

describe("relativePublicationPath", () => {
  it("relative paths require a segment boundary", () => {
    expect(relativePublicationPath("docs/a.md", "docs")).toBe("a.md");
    expect(relativePublicationPath("docs2/a.md", "docs")).toBeNull();
    expect(relativePublicationPath(null, "docs")).toBeNull();
  });

  it("keeps nested segments and the original case", () => {
    expect(relativePublicationPath("Docs/Design/API.md", "Docs")).toBe("Design/API.md");
  });

  it("treats a trailing slash on the root the same way", () => {
    expect(relativePublicationPath("docs/a.md", "docs/")).toBe("a.md");
  });

  it("does not treat the root folder itself as a document inside it", () => {
    expect(relativePublicationPath("docs", "docs")).toBeNull();
  });

  it("returns the whole path when the published root is the sync root", () => {
    expect(relativePublicationPath("docs/a.md", "")).toBe("docs/a.md");
  });
});

describe("planPublicationMoves", () => {
  it("applies a two-document swap", () => {
    const held = heldOf(heldDocument("doc-a", "a.md"), heldDocument("doc-b", "b.md"));
    const moves: PlannedMove[] = [
      { teamDocumentId: "doc-a", fromPath: "a.md", toPath: "b.md" },
      { teamDocumentId: "doc-b", fromPath: "b.md", toPath: "a.md" },
    ];

    const plan = planPublicationMoves(moves, held);

    expect(plan.applied).toHaveLength(2);
    expect(plan.blocked).toHaveLength(0);
    expect(pathsOf(plan.applied)).toEqual({ "doc-a": "b.md", "doc-b": "a.md" });
  });

  it("applies a three-document rotation", () => {
    const held = heldOf(
      heldDocument("doc-a", "a.md"),
      heldDocument("doc-b", "b.md"),
      heldDocument("doc-c", "c.md"),
    );
    const moves: PlannedMove[] = [
      { teamDocumentId: "doc-a", fromPath: "a.md", toPath: "b.md" },
      { teamDocumentId: "doc-b", fromPath: "b.md", toPath: "c.md" },
      { teamDocumentId: "doc-c", fromPath: "c.md", toPath: "a.md" },
    ];

    const plan = planPublicationMoves(moves, held);

    expect(plan.applied).toHaveLength(3);
    expect(plan.blocked).toHaveLength(0);
  });

  it("applies a move into a path freed by another move", () => {
    const held = heldOf(heldDocument("doc-a", "a.md"), heldDocument("doc-b", "b.md"));
    const moves: PlannedMove[] = [
      { teamDocumentId: "doc-a", fromPath: "a.md", toPath: "b.md" },
      { teamDocumentId: "doc-b", fromPath: "b.md", toPath: "nested/b.md" },
    ];

    const plan = planPublicationMoves(moves, held);

    expect(plan.applied).toHaveLength(2);
    expect(plan.blocked).toHaveLength(0);
  });

  it("blocks every move that competes for the same final path", () => {
    const held = heldOf(heldDocument("doc-a", "a.md"), heldDocument("doc-b", "b.md"));
    const moves: PlannedMove[] = [
      { teamDocumentId: "doc-a", fromPath: "a.md", toPath: "shared.md" },
      { teamDocumentId: "doc-b", fromPath: "b.md", toPath: "shared.md" },
    ];

    const plan = planPublicationMoves(moves, held);

    expect(plan.applied).toHaveLength(0);
    expect(plan.blocked).toHaveLength(2);
  });

  it("blocks a move onto a path held by a document that does not move", () => {
    const held = heldOf(heldDocument("doc-a", "a.md"), heldDocument("doc-b", "b.md"));
    const moves: PlannedMove[] = [{ teamDocumentId: "doc-a", fromPath: "a.md", toPath: "b.md" }];

    const plan = planPublicationMoves(moves, held);

    expect(plan.applied).toHaveLength(0);
    expect(plan.blocked).toEqual(moves);
  });

  it("keeps a blocked document at its old path so it still blocks dependents", () => {
    const held = heldOf(
      heldDocument("doc-a", "a.md"),
      heldDocument("doc-b", "b.md"),
      heldDocument("doc-c", "c.md"),
      heldDocument("doc-static", "d.md"),
    );
    const moves: PlannedMove[] = [
      { teamDocumentId: "doc-a", fromPath: "a.md", toPath: "b.md" },
      { teamDocumentId: "doc-b", fromPath: "b.md", toPath: "c.md" },
      { teamDocumentId: "doc-c", fromPath: "c.md", toPath: "d.md" },
    ];

    const plan = planPublicationMoves(moves, held);

    expect(plan.applied).toHaveLength(0);
    expect(plan.blocked).toHaveLength(3);
  });

  it("lets a path reservation cascade only as far as the blocker reaches", () => {
    const held = heldOf(
      heldDocument("doc-a", "a.md"),
      heldDocument("doc-b", "b.md"),
      heldDocument("doc-static", "taken.md"),
      heldDocument("doc-c", "c.md"),
    );
    const moves: PlannedMove[] = [
      { teamDocumentId: "doc-a", fromPath: "a.md", toPath: "taken.md" },
      { teamDocumentId: "doc-b", fromPath: "b.md", toPath: "a.md" },
      { teamDocumentId: "doc-c", fromPath: "c.md", toPath: "free.md" },
    ];

    const plan = planPublicationMoves(moves, held);

    // doc-a hits a static reservation; doc-b then cannot take a.md because
    // blocked doc-a stays there. doc-c is independent and still applies.
    expect(pathsOf(plan.applied)).toEqual({ "doc-c": "free.md" });
    expect(plan.blocked.map((move) => move.teamDocumentId).sort()).toEqual(["doc-a", "doc-b"]);
  });

  it("allows several documents to move to a NULL path because NULL reserves nothing", () => {
    const held = heldOf(
      heldDocument("doc-a", "a.md"),
      heldDocument("hub-a", null),
      heldDocument("hub-b", null),
    );
    const moves: PlannedMove[] = [
      { teamDocumentId: "doc-a", fromPath: "a.md", toPath: null },
      { teamDocumentId: "hub-a", fromPath: null, toPath: null },
      { teamDocumentId: "hub-b", fromPath: null, toPath: null },
    ];

    const plan = planPublicationMoves(moves, held);

    expect(plan.applied).toHaveLength(3);
    expect(plan.blocked).toHaveLength(0);
  });

  it("applies no moves when there are none", () => {
    const plan = planPublicationMoves([], heldOf(heldDocument("doc-a", "a.md")));
    expect(plan).toEqual({ applied: [], blocked: [] });
  });
});

describe("publicationOverlap", () => {
  it("measures shared relative paths over the union", () => {
    expect(publicationOverlap(["a.md", "b.md"], ["a.md"])).toBe(0.5);
  });

  it("returns 1 for identical path sets", () => {
    expect(publicationOverlap(["a.md", "b.md"], ["b.md", "a.md"])).toBe(1);
  });

  it("returns 0 for disjoint path sets", () => {
    expect(publicationOverlap(["a.md"], ["b.md"])).toBe(0);
  });

  it("returns 0 when either side has no synced path, so no join is suggested", () => {
    expect(publicationOverlap([], ["a.md"])).toBe(0);
    expect(publicationOverlap(["a.md"], [])).toBe(0);
    expect(publicationOverlap([], [])).toBe(0);
  });
});
