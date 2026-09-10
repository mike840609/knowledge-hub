import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalizeJsonObject,
  isSameRevisionContent,
  normalizeRevisionContent,
  normalizeStoredRevisionContent,
  revisionContentHash,
  revisionContentPayload,
  type RevisionContentInput,
} from "@/modules/knowledge/domain/content";
import { isRevisionContentUnchanged } from "@/modules/knowledge/domain/revision";
import { contentFingerprint, type KnowledgeMetadata } from "@/modules/knowledge/domain/content";

const base: RevisionContentInput = {
  title: "A title",
  markdown: "# body\nsecond line\n",
  metadata: { z: 1, nested: { b: true, a: "x" }, list: ["a", 2] },
};

function phase0Encode(input: RevisionContentInput): { title: string; markdown: string; metadata: KnowledgeMetadata; contentHash: string } {
  // Phase 0 stored rows: raw title/markdown, unsorted metadata, unprefixed SHA-256.
  return {
    title: input.title,
    markdown: input.markdown,
    metadata: input.metadata,
    contentHash: createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex"),
  };
}

describe("normalizeRevisionContent (candidate-only)", () => {
  it("trims the title and rejects empty titles", () => {
    expect(normalizeRevisionContent({ ...base, title: "  Padded title  " }).title).toBe("Padded title");
    expect(() => normalizeRevisionContent({ ...base, title: "" })).toThrowError(
      expect.objectContaining({ code: "INVALID_TITLE" }),
    );
    expect(() => normalizeRevisionContent({ ...base, title: "   \t  " })).toThrowError(
      expect.objectContaining({ code: "INVALID_TITLE" }),
    );
  });

  it("converts CRLF to LF without touching other whitespace", () => {
    const normalized = normalizeRevisionContent({ ...base, markdown: "a\r\nb\r\n  trailing  \r\rc" });
    expect(normalized.markdown).toBe("a\nb\n  trailing  \r\rc");
  });

  it("recursively sorts metadata keys while preserving array order", () => {
    const reordered: RevisionContentInput = {
      ...base,
      metadata: { list: ["a", 2], nested: { a: "x", b: true }, z: 1 },
    };
    expect(normalizeRevisionContent(reordered).metadata).toEqual(normalizeRevisionContent(base).metadata);
    expect(canonicalizeJsonObject({ b: 1, a: 2 })).toEqual({ a: 2, b: 1 });
  });

  it("treats reordered arrays as different content", () => {
    const left = revisionContentHash(normalizeRevisionContent(base));
    const right = revisionContentHash(normalizeRevisionContent({ ...base, metadata: { ...base.metadata, list: [2, "a"] } }));
    expect(left).not.toBe(right);
  });

  it("changes fingerprint on title-only, markdown-only, and metadata-only changes", () => {
    const fingerprint = revisionContentHash(normalizeRevisionContent(base));
    expect(revisionContentHash(normalizeRevisionContent({ ...base, title: "Changed" }))).not.toBe(fingerprint);
    expect(revisionContentHash(normalizeRevisionContent({ ...base, markdown: "changed" }))).not.toBe(fingerprint);
    expect(revisionContentHash(normalizeRevisionContent({ ...base, metadata: { ...base.metadata, z: 2 } }))).not.toBe(fingerprint);
  });

  it("rejects invalid JSON metadata values", () => {
    const sparse: unknown[] = [];
    sparse.length = 1;
    for (const bad of [
      { sparse: sparse as never },
      { bad: Number.NaN },
      { bad: Number.POSITIVE_INFINITY },
      { bad: undefined as never },
      { bad: (() => 1) as never },
    ] as Record<string, unknown>[]) {
      expect(() => normalizeRevisionContent({ ...base, metadata: bad as RevisionContentInput["metadata"] })).toThrowError(
        expect.objectContaining({ code: "INVALID_METADATA" }),
      );
    }
    expect(() => normalizeRevisionContent({ ...base, metadata: "nope" as never })).toThrowError(
      expect.objectContaining({ code: "INVALID_METADATA" }),
    );
  });
});

describe("revision fingerprint contract", () => {
  it("hashes the prefixed canonical payload", () => {
    const normalized = normalizeRevisionContent(base);
    const payload = revisionContentPayload(normalized);
    expect(payload.startsWith("knowledge-revision:v1\0")).toBe(true);
    expect(payload.slice("knowledge-revision:v1\0".length)).toBe(
      JSON.stringify({ title: normalized.title, markdown: normalized.markdown, metadata: normalized.metadata }),
    );
    expect(revisionContentHash(normalized)).toBe(createHash("sha256").update(payload, "utf8").digest("hex"));
    expect(revisionContentHash(normalized)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs from the legacy Phase 0 fingerprint for identical content", () => {
    expect(revisionContentHash(normalizeRevisionContent(base))).not.toBe(contentFingerprint(base));
  });
});

describe("stored-side comparison normalizer (§13.1)", () => {
  it("permits empty trimmed legacy titles without validation", () => {
    const stored = normalizeStoredRevisionContent({ title: "   ", markdown: "m", metadata: {} });
    expect(stored.title).toBe("");
  });

  it("still trims, converts CRLF, and sorts keys on the stored side", () => {
    const stored = normalizeStoredRevisionContent({ title: "  T  ", markdown: "a\r\nb", metadata: { b: 1, a: 2 } });
    expect(stored).toEqual({ title: "T", markdown: "a\nb", metadata: { a: 2, b: 1 } });
  });

  it("compares canonical payloads so Phase 0 rows NOOP against equivalent candidates", () => {
    const stored = phase0Encode({ title: "  Spaced  ", markdown: "a\r\nb", metadata: { b: 1, a: 2 } });
    expect(
      isSameRevisionContent(stored, { title: "Spaced", markdown: "a\nb", metadata: { a: 2, b: 1 } }),
    ).toBe(true);
  });

  it("never compares stored hash against the new hash", () => {
    const stored = { ...phase0Encode(base), contentHash: "deliberately-wrong-hash" };
    expect(isSameRevisionContent(stored, base)).toBe(true);
  });

  it("detects real title, markdown, and metadata changes", () => {
    const stored = phase0Encode(base);
    expect(isSameRevisionContent(stored, { ...base, title: "Other" })).toBe(false);
    expect(isSameRevisionContent(stored, { ...base, markdown: "other" })).toBe(false);
    expect(isSameRevisionContent(stored, { ...base, metadata: { ...base.metadata, z: 9 } })).toBe(false);
  });

  it("lets a legacy whitespace-only title be corrected by a valid candidate", () => {
    const stored = phase0Encode({ title: "   ", markdown: "m", metadata: {} });
    expect(isSameRevisionContent(stored, { title: "Fixed", markdown: "m", metadata: {} })).toBe(false);
    expect(() => normalizeRevisionContent({ title: "   ", markdown: "m", metadata: {} })).toThrowError(
      expect.objectContaining({ code: "INVALID_TITLE" }),
    );
  });
});

describe("revision domain comparator", () => {
  it("compares a stored KnowledgeRevision row against a candidate payload", () => {
    const stored = {
      id: "r1",
      documentId: "d1",
      revisionNo: 1,
      ...phase0Encode(base),
      createdBy: "u",
      createdAt: new Date(0),
    };
    expect(isRevisionContentUnchanged(stored, base)).toBe(true);
    expect(isRevisionContentUnchanged(stored, { ...base, markdown: "changed" })).toBe(false);
  });
});
