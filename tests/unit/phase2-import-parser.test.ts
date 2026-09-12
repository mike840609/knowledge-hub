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
