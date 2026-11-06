import { describe, expect, it } from "vitest";
import { TaskArtifactError } from "@/modules/task-knowledge/domain/task-errors";
import {
  parseTaskReference,
  validateCodeFilePath,
  validateCommitId,
  validatePrUrl,
  validateWikiReferencePath,
} from "@/modules/task-knowledge/domain/task-references";

const rejects = (fn: () => unknown) => expect(fn).toThrow(TaskArtifactError);

describe("WIKI reference path", () => {
  it("accepts a source-relative path and returns it unchanged", () => {
    expect(validateWikiReferencePath("architecture/auth.md")).toBe("architecture/auth.md");
    expect(validateWikiReferencePath("./architecture//auth.md")).toBe("./architecture//auth.md");
  });

  it.each([
    "../secrets.md",
    "architecture/../../x.md",
    "a/..",
    "/tmp/note.md",
    "\\share\\note.md",
    "C:\\secret.md",
    "c:/secret.md",
    "a\\..\\b.md",
    "note\u0000.md",
    "note\n.md",
    "",
  ])("rejects %j", (value) => rejects(() => validateWikiReferencePath(value)));
});

describe("CODE_FILE reference path", () => {
  it("accepts a project-relative path", () => {
    expect(validateCodeFilePath("src/lib/x.ts")).toBe("src/lib/x.ts");
  });

  it.each(["/etc/passwd", "\\src\\x.ts", "src/../src/x.ts", "..", "D:\\x.ts", "src/x\u0007.ts", "x".repeat(1025)])(
    "rejects %j",
    (value) => rejects(() => validateCodeFilePath(value)),
  );
});

describe("PR_URL reference", () => {
  it("accepts an https URL", () => {
    expect(validatePrUrl("https://github.com/org/repo/pull/1")).toBe("https://github.com/org/repo/pull/1");
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,x",
    "http://github.com/org/repo/pull/1",
    "https://user:pass@host/pull/1",
    "https://user@host/pull/1",
    "https://host/pull/1\n",
    "https://host/\u0000",
    `https://host/${"a".repeat(2048)}`,
    "not a url",
  ])("rejects %j", (value) => rejects(() => validatePrUrl(value)));
});

describe("COMMIT reference", () => {
  it("accepts a hex SHA", () => {
    expect(validateCommitId("9dd98f94a1b2c3d4e5f60718293a4b5c6d7e8f90")).toBe("9dd98f94a1b2c3d4e5f60718293a4b5c6d7e8f90");
  });

  it.each(["", "abc def", "abc\n", "a".repeat(129), "abc;rm"])("rejects %j", (value) =>
    rejects(() => validateCommitId(value)),
  );
});

describe("reference shape", () => {
  it("parses each reference type", () => {
    expect(parseTaskReference({ type: "WIKI", path: "a.md" }, 0)).toEqual({ type: "WIKI", path: "a.md" });
    const documentId = "0192f0a4-1b2c-7d3e-8f40-123456789abc";
    expect(parseTaskReference({ type: "WIKI", documentId }, 0)).toEqual({ type: "WIKI", documentId });
    expect(parseTaskReference({ type: "CODE_FILE", path: "src/x.ts" }, 0)).toEqual({ type: "CODE_FILE", path: "src/x.ts" });
    expect(parseTaskReference({ type: "COMMIT", id: "abc1234" }, 0)).toEqual({ type: "COMMIT", id: "abc1234" });
    expect(parseTaskReference({ type: "PR_URL", url: "https://h/p/1" }, 0)).toEqual({ type: "PR_URL", url: "https://h/p/1" });
  });

  it("names the reference index and never the rejected value", () => {
    expect(() => parseTaskReference({ type: "CODE_FILE", path: "/home/me/secret-project/x.ts" }, 3)).toThrow(
      /references\[3\]/,
    );
    try {
      parseTaskReference({ type: "CODE_FILE", path: "/home/me/secret-project/x.ts" }, 3);
    } catch (error) {
      expect((error as Error).message).not.toContain("secret-project");
    }
  });
});
