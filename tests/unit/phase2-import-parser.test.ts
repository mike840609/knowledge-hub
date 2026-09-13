import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeUtf8Markdown, parseGenericMarkdownText } from "@/modules/sources/adapters/generic-markdown-folder-adapter";
import { isIgnoredImportPath, normalizeImportPath } from "@/modules/sources/domain/import-path";

const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

describe("Phase 2 import path", () => {
  it("normalizes separators/dot segments and preserves case", () => {
    expect(normalizeImportPath("Docs\\./K8s/Ingress.MD").sourcePath).toBe("Docs/K8s/Ingress.MD");
  });

  it("rejects unsafe paths", () => {
    for (const value of [
      "../x.md",
      "/x.md",
      "\\rooted.md",
      "\\\\server\\share.md",
      "C:\\x.md",
      "a\u0000b.md",
      "a\u001fb.md",
      "a\u007fb.md",
    ]) {
      expect(() => normalizeImportPath(value)).toThrowError(expect.objectContaining({ code: "INVALID_SOURCE_PATH" }));
    }
  });

  it("ignores hidden/system paths", () => {
    for (const value of [".git/config", ".obsidian/app.json", "node_modules/a.md", "docs/.cache/a.md", ".DS_Store", "Thumbs.db"]) {
      expect(isIgnoredImportPath(value)).toBe(true);
    }
    expect(isIgnoredImportPath("docs/a.md")).toBe(false);
  });
});

describe("Phase 2 Markdown adapter", () => {
  it("accepts BOM and rejects invalid UTF-8", () => {
    expect(decodeUtf8Markdown(new Uint8Array([0xef, 0xbb, 0xbf, 0x23, 0x20, 0x41]))).toBe("# A");
    expect(() => decodeUtf8Markdown(new Uint8Array([0xc3, 0x28]))).toThrowError(expect.objectContaining({ code: "INVALID_MARKDOWN_ENCODING" }));
  });

  it("separates frontmatter and warns on title conflict", () => {
    const text = "---\ntitle: Canonical\ntags: [b, a]\n---\n# Different\n\nBody\n";
    const result = parseGenericMarkdownText({ sourcePath: "docs/a.md", text, sourceFileHash: hash(text) });
    expect(result.resolvedTitle).toBe("Canonical");
    expect(result.markdown).toBe("# Different\n\nBody\n");
    expect(result.metadata).toEqual({ tags: ["b", "a"], title: "Canonical" });
    expect(result.diagnostics.map((item) => item.code)).toContain("TITLE_CONFLICT");
  });

  it("uses a real H1, not fenced code", () => {
    const text = "```md\n# Fake\n```\n\n# Real\n";
    expect(parseGenericMarkdownText({ sourcePath: "a.md", text, sourceFileHash: hash(text) }).resolvedTitle).toBe("Real");
  });

  it("keeps reconciliation fingerprint stable when filename-derived title changes", () => {
    const left = parseGenericMarkdownText({ sourcePath: "foo.md", text: "body\n", sourceFileHash: hash("body\n") });
    const right = parseGenericMarkdownText({ sourcePath: "bar.md", text: "body\n", sourceFileHash: hash("body\n") });
    expect(left.reconciliationFingerprint).toBe(right.reconciliationFingerprint);
    expect(left.revisionContentHash).not.toBe(right.revisionContentHash);
  });
});

describe("Phase 2 Markdown adapter frontmatter root", () => {
  const parse = (sourcePath: string, text: string) =>
    parseGenericMarkdownText({ sourcePath, text, sourceFileHash: hash(text) });

  it("treats an empty frontmatter fence as empty metadata and keeps the body", () => {
    const result = parse("docs/a.md", "---\n---\n# Heading\n\nbody\n");
    expect(result.metadata).toEqual({});
    expect(result.markdown).toBe("# Heading\n\nbody\n");
    expect(result.resolvedTitle).toBe("Heading");
    expect(result.titleSource).toBe("H1");
    expect(result.diagnostics).toEqual([]);
  });

  it("falls back to the filename title when an empty fence has no H1", () => {
    const result = parse("docs/Empty Props.md", "---\n---\n\nbody only\n");
    expect(result.metadata).toEqual({});
    expect(result.resolvedTitle).toBe("Empty Props");
    expect(result.titleSource).toBe("FILENAME");
    expect(result.diagnostics).toEqual([]);
  });

  it("treats a blank-line-only or comment-only fence as empty metadata", () => {
    for (const yamlText of ["\n", "\n\n   \n", "# only a comment", "\n# c1\n\n# c2\n"]) {
      const result = parse("docs/a.md", `---\n${yamlText}\n---\n# Heading\n\nbody\n`);
      expect(result.metadata).toEqual({});
      expect(result.markdown).toBe("# Heading\n\nbody\n");
      expect(result.diagnostics).toEqual([]);
    }
  });

  it("treats an explicit empty mapping as empty metadata", () => {
    const result = parse("docs/a.md", "---\n{}\n---\n# Heading\n");
    expect(result.metadata).toEqual({});
    expect(result.diagnostics).toEqual([]);
  });

  it("makes an empty fence equivalent to no fence for reconciliation", () => {
    const withFence = parse("docs/a.md", "---\n---\n# Heading\n\nbody\n");
    const withoutFence = parse("docs/a.md", "# Heading\n\nbody\n");
    expect(withFence.reconciliationFingerprint).toBe(withoutFence.reconciliationFingerprint);
    expect(withFence.revisionContentHash).toBe(withoutFence.revisionContentHash);
  });

  it("keeps a file with no frontmatter fence working", () => {
    const result = parse("docs/a.md", "# Heading\n\nbody\n");
    expect(result.metadata).toEqual({});
    expect(result.markdown).toBe("# Heading\n\nbody\n");
    expect(result.resolvedTitle).toBe("Heading");
  });

  it("rejects a non-object frontmatter root", () => {
    for (const yamlText of ["42", "- a\n- b", '"text"', "text", "true", "[1, 2]"]) {
      expect(() => parse("docs/a.md", `---\n${yamlText}\n---\n# Heading\n`)).toThrowError(
        expect.objectContaining({ code: "FRONTMATTER_NOT_OBJECT" }),
      );
    }
  });

  // An explicit null literal stays blocking: the author wrote a value, so this
  // is a malformed root rather than the "no properties" case an empty fence means.
  it("rejects an explicit null frontmatter root", () => {
    for (const yamlText of ["null", "~", "Null", "NULL"]) {
      expect(() => parse("docs/a.md", `---\n${yamlText}\n---\n# Heading\n`)).toThrowError(
        expect.objectContaining({ code: "FRONTMATTER_NOT_OBJECT" }),
      );
    }
  });

  it("still rejects malformed frontmatter YAML", () => {
    for (const yamlText of ["a: [1, 2", "a:\n\tb: 1", "a: 1\na: 2"]) {
      expect(() => parse("docs/a.md", `---\n${yamlText}\n---\n# Heading\n`)).toThrowError(
        expect.objectContaining({ code: "INVALID_FRONTMATTER" }),
      );
    }
  });

  it("still rejects an unclosed frontmatter fence", () => {
    expect(() => parse("docs/a.md", "---\ntitle: A\n# Heading\n")).toThrowError(
      expect.objectContaining({ code: "INVALID_FRONTMATTER" }),
    );
  });
});
