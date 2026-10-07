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

  // Spec §7.2 (amended 2026-10-07): unreadable frontmatter is a warning. The note imports
  // with its body and no properties, so one mistyped file cannot block a whole folder.
  const parseForSync = (text: string) =>
    parseGenericMarkdownText({ sourcePath: "docs/a.md", text, sourceFileHash: createHash("sha256").update(text).digest("hex"), unreadableFrontmatter: "warn" });

  function expectUnreadable(text: string, code: "INVALID_FRONTMATTER" | "FRONTMATTER_NOT_OBJECT", body: string) {
    const result = parseForSync(text);
    expect(result.metadata).toEqual({});
    expect(result.markdown).toBe(body);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code, severity: "WARNING", sourcePath: "docs/a.md" }));
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "BLOCKING")).toBe(false);
    return result;
  }

  it("imports a note whose frontmatter root is not an object, with a warning", () => {
    for (const yamlText of ["42", "- a\n- b", '"text"', "text", "true", "[1, 2]", "null", "~"]) {
      expectUnreadable(`---\n${yamlText}\n---\n# Heading\n`, "FRONTMATTER_NOT_OBJECT", "# Heading\n");
    }
  });

  it("imports a note with malformed frontmatter YAML, with a warning and the reason", () => {
    for (const yamlText of ["a: [1, 2", "a:\n\tb: 1", "a: 1\na: 2"]) {
      expectUnreadable(`---\n${yamlText}\n---\n# Heading\n`, "INVALID_FRONTMATTER", "# Heading\n");
    }
  });

  it("imports the frontmatter mistakes real vaults make, titled by their H1", () => {
    const cases = [
      ["unquoted colon in a title", "title: Git: tips and tricks"],
      ["tab-indented list", "tags:\n\t- a\n\t- b"],
      ["a key written twice", "tags: [a]\ntags: [b]"],
    ];
    for (const [name, yamlText] of cases) {
      const result = expectUnreadable(`---\n${yamlText}\n---\n# Real title\nBody\n`, "INVALID_FRONTMATTER", "# Real title\nBody\n");
      expect(result.resolvedTitle, name).toBe("Real title");
      expect(result.diagnostics.find((diagnostic) => diagnostic.code === "INVALID_FRONTMATTER")?.message, name).toMatch(/imported without its properties/);
    }
  });

  it("treats a file whose opening fence never closes as body, with a warning", () => {
    expectUnreadable("---\ntitle: A\n# Heading\n", "INVALID_FRONTMATTER", "---\ntitle: A\n# Heading\n");
  });

  it("still rejects unreadable frontmatter by default, as a single uploaded file needs", () => {
    for (const text of ["---\ntitle: Git: tips\n---\n# H\n", "---\n- a\n---\n# H\n", "---\ntitle: A\n# H\n"]) {
      expect(() => parse("docs/a.md", text)).toThrowError(expect.objectContaining({ code: expect.stringMatching(/^(INVALID_FRONTMATTER|FRONTMATTER_NOT_OBJECT)$/) }));
    }
  });

  it("still blocks a knowledge_id it cannot use, because identity decides which document this is", () => {
    expect(() => parseForSync("---\nknowledge_id: 123\n---\n# Heading\n")).toThrowError(
      expect.objectContaining({ code: "INVALID_KNOWLEDGE_ID" }),
    );
  });
});


describe("Markdown stable source identity", () => {
  const parse = (text: string) => parseGenericMarkdownText({ sourcePath: "auth.md", text, sourceFileHash: hash(text) });

  it("extracts and trims a case-sensitive opaque identity without changing content hashes", () => {
    const withoutId = parse("---\ntitle: Auth\nowner: platform\n---\nbody\n");
    const withId = parse('---\nknowledge_id: "  Auth-001  "\ntitle: Auth\nowner: platform\n---\nbody\n');
    expect(withoutId.externalId).toBeNull();
    expect(withId.externalId).toBe("Auth-001");
    expect(withId.metadata).toEqual({ title: "Auth", owner: "platform" });
    expect(withId.resolvedTitle).toBe(withoutId.resolvedTitle);
    expect(withId.revisionContentHash).toBe(withoutId.revisionContentHash);
    expect(withId.reconciliationFingerprint).toBe(withoutId.reconciliationFingerprint);
    expect(withId.sourceFileHash).not.toBe(withoutId.sourceFileHash);
  });

  it.each(["null", '""', '"   "', "123", "true", "[a, b]", "{value: a}", JSON.stringify("a".repeat(513))])(
    "rejects invalid knowledge_id %s", (value) => {
      expect(() => parse(`---\nknowledge_id: ${value}\n---\nbody\n`)).toThrowError(
        expect.objectContaining({ code: "INVALID_KNOWLEDGE_ID" }),
      );
    },
  );

  it("measures the 512-character storage limit in Unicode characters", () => {
    expect(parse(`---\nknowledge_id: "${"😀".repeat(512)}"\n---\nbody\n`).externalId).toBe("😀".repeat(512));
    expect(() => parse(`---\nknowledge_id: "${"😀".repeat(513)}"\n---\nbody\n`)).toThrowError(
      expect.objectContaining({ code: "INVALID_KNOWLEDGE_ID" }),
    );
  });

  it("reserves only the top-level field", () => {
    expect(parse("---\nowner:\n  knowledge_id: nested\n---\nbody\n").metadata).toEqual({ owner: { knowledge_id: "nested" } });
  });
});
