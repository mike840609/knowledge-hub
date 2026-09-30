import { describe, expect, it } from "vitest";
import {
  MAX_FOLDER_NAME_LENGTH,
  MAX_MARKDOWN_BYTES,
  MAX_TITLE_LENGTH,
  parseCreateDocumentInput,
  parseCreateFolderInput,
  parseRenameFolderInput,
  parseUpdateDocumentInput,
  requireRouteId,
} from "@/server/authoring-input";
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
      .toEqual({ title: "Runbook", markdown: "# Hi", metadata: {}, parentId: null });
  });

  it("resolves the title from frontmatter when a filename is given", () => {
    const markdown = "---\ntitle: 請假流程\n---\n\n# Something Else\n";
    expect(parseCreateDocumentInput({ filename: "leave.md", markdown }).title).toBe("請假流程");
  });

  it("strips frontmatter from the stored body and preserves it as metadata (spec §6.2)", () => {
    const markdown = "---\ntitle: 請假流程\nowner: hr\n---\n\n# Something Else\n\nBody text.\n";
    const result = parseCreateDocumentInput({ filename: "leave.md", markdown });
    expect(result.markdown).not.toContain("---");
    expect(result.markdown).not.toContain("title: 請假流程");
    expect(result.markdown).toContain("Body text.");
    expect(result.metadata).toEqual({ title: "請假流程", owner: "hr" });
  });

  it("returns empty metadata for a filename upload with no frontmatter", () => {
    const result = parseCreateDocumentInput({ filename: "leave.md", markdown: "# Leave Policy\n" });
    expect(result.metadata).toEqual({});
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

const ID = "0198f0a0-7c1e-7a3b-9d5e-0123456789ab";

describe("a parent folder on a new document (daily-driver spec §7.1)", () => {
  it("is the top level unless one is given", () => {
    expect(parseCreateDocumentInput({ title: "A", markdown: "x" }).parentId).toBeNull();
    expect(parseCreateDocumentInput({ title: "A", markdown: "x", parentId: null }).parentId).toBeNull();
  });

  it("is kept when it is an ID, on a typed title and on an upload", () => {
    expect(parseCreateDocumentInput({ title: "A", markdown: "x", parentId: ID }).parentId).toBe(ID);
    expect(parseCreateDocumentInput({ filename: "a.md", markdown: "# A", parentId: ID }).parentId).toBe(ID);
  });

  it.each([
    { parentId: "", why: "an empty string" },
    { parentId: "not-an-id", why: "text" },
    { parentId: 5, why: "a number" },
    { parentId: {}, why: "an object" },
    { parentId: "0198f0a0-7c1e-7a3b-9d5e-0123456789a", why: "an ID one character short" },
  ])("is refused as $why", ({ parentId }) => {
    const error = thrownBy(() => parseCreateDocumentInput({ title: "A", markdown: "x", parentId }));
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe("INVALID_REQUEST");
  });
});

describe("parseCreateFolderInput", () => {
  it("takes a name and, optionally, a parent and a source", () => {
    expect(parseCreateFolderInput({ name: "Runbooks" })).toEqual({ sourceId: null, parentId: null, name: "Runbooks" });
    expect(parseCreateFolderInput({ name: "Runbooks", parentId: ID, sourceId: ID })).toEqual({ sourceId: ID, parentId: ID, name: "Runbooks" });
    expect(parseCreateFolderInput({ name: "Runbooks", parentId: null, sourceId: null })).toEqual({ sourceId: null, parentId: null, name: "Runbooks" });
  });

  it("trims the name, as the domain does", () => {
    expect(parseCreateFolderInput({ name: "  請假流程  " }).name).toBe("請假流程");
  });

  it("refuses an empty or blank name, and a name that is not text", () => {
    for (const name of ["", "   ", "\n\t"]) expect(() => parseCreateFolderInput({ name })).toThrow();
    expect(() => parseCreateFolderInput({ name: 5 })).toThrow();
    expect(() => parseCreateFolderInput({})).toThrow();
  });

  it("allows the longest name the column holds and refuses one more", () => {
    expect(parseCreateFolderInput({ name: "x".repeat(MAX_FOLDER_NAME_LENGTH) }).name).toHaveLength(MAX_FOLDER_NAME_LENGTH);
    expect(() => parseCreateFolderInput({ name: "x".repeat(MAX_FOLDER_NAME_LENGTH + 1) })).toThrow(/too long/i);
  });

  it("counts the name after trimming, not before", () => {
    expect(() => parseCreateFolderInput({ name: ` ${"x".repeat(MAX_FOLDER_NAME_LENGTH)} ` })).not.toThrow();
  });

  it.each([["bad", "sourceId"], ["bad", "parentId"], [5, "sourceId"], [5, "parentId"]])("refuses %j as %s", (value, field) => {
    const error = thrownBy(() => parseCreateFolderInput({ name: "A", [field]: value }));
    expect((error as DomainError).code).toBe("INVALID_REQUEST");
  });

  it("refuses a body that is not an object", () => {
    for (const body of [null, undefined, "x", 5, [], [{ name: "A" }]]) expect(() => parseCreateFolderInput(body)).toThrow();
  });
});

describe("parseRenameFolderInput", () => {
  it("takes the same name, with the same limits", () => {
    expect(parseRenameFolderInput({ name: " New name " })).toEqual({ name: "New name" });
    expect(() => parseRenameFolderInput({ name: " " })).toThrow();
    expect(() => parseRenameFolderInput({ name: "x".repeat(MAX_FOLDER_NAME_LENGTH + 1) })).toThrow();
    expect(() => parseRenameFolderInput({})).toThrow();
    expect(() => parseRenameFolderInput(null)).toThrow();
  });
});

describe("requireRouteId", () => {
  it("passes an ID and refuses anything else with a 400-class code", () => {
    expect(requireRouteId(ID, "the folder")).toBe(ID);
    for (const bad of ["", "abc", "../etc", ID + "x", ID.toUpperCase() + " "]) {
      const error = thrownBy(() => requireRouteId(bad, "the folder"));
      expect((error as DomainError).code).toBe("INVALID_REQUEST");
    }
  });
});
