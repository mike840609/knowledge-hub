import { describe, expect, it } from "vitest";
import { canonicalContent, contentFingerprint, normalizeContent, sameContent, type ContentInput } from "@/modules/knowledge/domain/content";
import { ValidationError } from "@/modules/knowledge/domain/errors";

const base: ContentInput = { title: "A title", markdown: "# body\n", metadata: { z: 1, nested: { b: true, a: "x" }, list: ["a", 2] } };

describe("canonical Knowledge content", () => {
  it("includes title, markdown, and metadata in the fingerprint", () => {
    expect(contentFingerprint({ ...base, title: "Changed" })).not.toBe(contentFingerprint(base));
    expect(contentFingerprint({ ...base, markdown: "changed" })).not.toBe(contentFingerprint(base));
    expect(contentFingerprint({ ...base, metadata: { ...base.metadata, z: 2 } })).not.toBe(contentFingerprint(base));
  });

  it("treats recursively reordered object keys as the same content", () => {
    const reordered: ContentInput = { title: base.title, markdown: base.markdown, metadata: { list: ["a", 2], nested: { a: "x", b: true }, z: 1 } };
    expect(sameContent(base, reordered)).toBe(true);
    expect(contentFingerprint(base)).toBe(contentFingerprint(reordered));
  });

  it("preserves the __proto__ metadata key and detects its changes", () => {
    const first = JSON.parse('{"__proto__":{"value":1}}') as ContentInput["metadata"];
    const second = JSON.parse('{"__proto__":{"value":2}}') as ContentInput["metadata"];
    const serializedMetadata = JSON.parse(canonicalContent({ ...base, metadata: first })).metadata as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(serializedMetadata, "__proto__")).toBe(true);
    expect((serializedMetadata["__proto__"] as Record<string, unknown>).value).toBe(1);
    expect(contentFingerprint({ ...base, metadata: first })).not.toBe(contentFingerprint({ ...base, metadata: second }));
  });

  it("rejects sparse arrays and non-JSON values", () => {
    const sparse: unknown[] = [];
    sparse.length = 1;
    expect(() => normalizeContent({ ...base, metadata: { sparse: sparse as never } })).toThrow(ValidationError);
    expect(() => normalizeContent({ ...base, metadata: { bad: Number.NaN } })).toThrow(ValidationError);
  });

  it("does not trim user strings", () => {
    const input = { title: " title ", markdown: " line\r\n", metadata: {} };
    expect(normalizeContent(input)).toEqual(input);
  });
});
