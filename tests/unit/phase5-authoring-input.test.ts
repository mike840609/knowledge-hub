import { describe, expect, it } from "vitest";
import { MAX_MARKDOWN_BYTES, MAX_TITLE_LENGTH, parseCreateDocumentInput, parseUpdateDocumentInput } from "@/server/authoring-input";
import { DomainError } from "@/shared/domain/errors";
import { SourceImportError } from "@/modules/sources/domain/import-errors";

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the call to throw, but it returned normally.");
}

describe("parseCreateDocumentInput (spec §6.1, §6.2, §6.4)", () => {
  it("accepts an explicit title", () => {
    expect(parseCreateDocumentInput({ title: "Runbook", markdown: "# Hi" }))
      .toEqual({ title: "Runbook", markdown: "# Hi" });
  });

  it("resolves the title from frontmatter when a filename is given", () => {
    const markdown = "---\ntitle: 請假流程\n---\n\n# Something Else\n";
    expect(parseCreateDocumentInput({ filename: "leave.md", markdown }).title).toBe("請假流程");
  });

  it("falls back to the first H1, then to the filename stem", () => {
    expect(parseCreateDocumentInput({ filename: "leave.md", markdown: "# Leave Policy\n" }).title).toBe("Leave Policy");
    expect(parseCreateDocumentInput({ filename: "leave-policy.md", markdown: "no heading\n" }).title).toBe("leave-policy");
  });

  it("rejects giving both title and filename", () => {
    expect(() => parseCreateDocumentInput({ title: "A", filename: "a.md", markdown: "x" })).toThrow(/INVALID_REQUEST|exactly one/i);
  });

  it("rejects giving neither", () => {
    expect(() => parseCreateDocumentInput({ markdown: "x" })).toThrow();
  });

  it("rejects a non-object body and non-string fields", () => {
    expect(() => parseCreateDocumentInput(null)).toThrow();
    expect(() => parseCreateDocumentInput({ title: 5, markdown: "x" })).toThrow();
    expect(() => parseCreateDocumentInput({ title: "A", markdown: 5 })).toThrow();
  });

  it("rejects an over-long title and an over-large markdown body", () => {
    expect(() => parseCreateDocumentInput({ title: "x".repeat(MAX_TITLE_LENGTH + 1), markdown: "x" })).toThrow();
    expect(() => parseCreateDocumentInput({ title: "A", markdown: "x".repeat(MAX_MARKDOWN_BYTES + 1) })).toThrow();
  });

  it("rejects a blank title", () => {
    expect(() => parseCreateDocumentInput({ title: "   ", markdown: "x" })).toThrow();
  });

  it("rejects filename-based input with unclosed frontmatter", () => {
    const markdown = "---\ntitle: Test\nno closing delimiter\n";
    const error = thrownBy(() => parseCreateDocumentInput({ filename: "doc.md", markdown }));
    expect(error).toBeInstanceOf(DomainError);
    expect(error).not.toBeInstanceOf(SourceImportError);
    expect((error as DomainError).code).toBe("INVALID_REQUEST");
  });

  it("rejects filename-based input with non-object frontmatter", () => {
    const markdown = "---\njust a string\n---\n";
    const error = thrownBy(() => parseCreateDocumentInput({ filename: "doc.md", markdown }));
    expect(error).toBeInstanceOf(DomainError);
    expect(error).not.toBeInstanceOf(SourceImportError);
    expect((error as DomainError).code).toBe("INVALID_REQUEST");
  });

  it("rejects filename-based input with duplicate keys in frontmatter", () => {
    const markdown = "---\ntitle: First\ntitle: Second\n---\n";
    const error = thrownBy(() => parseCreateDocumentInput({ filename: "doc.md", markdown }));
    expect(error).toBeInstanceOf(DomainError);
    expect(error).not.toBeInstanceOf(SourceImportError);
    expect((error as DomainError).code).toBe("INVALID_REQUEST");
  });
});

describe("parseUpdateDocumentInput (spec §6.1)", () => {
  it("requires all three fields", () => {
    expect(parseUpdateDocumentInput({ title: "A", markdown: "b", expectedCurrentRevisionId: "r1" }))
      .toEqual({ title: "A", markdown: "b", expectedCurrentRevisionId: "r1" });
    expect(() => parseUpdateDocumentInput({ title: "A", markdown: "b" })).toThrow();
  });
});
