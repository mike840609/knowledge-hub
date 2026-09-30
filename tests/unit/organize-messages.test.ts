import { describe, expect, it } from "vitest";
import {
  archivedDocument,
  archivedFolder,
  createdFolder,
  folderNameProblem,
  organizeFailure,
  renamedFolder,
  restoredDocument,
  restoredFolder,
} from "@/components/knowledge/organize-messages";

describe("what an archive says", () => {
  it("names the document, and says nothing more when nothing linked to it", () => {
    expect(archivedDocument("Runbook", 0)).toBe("已封存「Runbook」。");
    expect(archivedDocument("Runbook", null)).toBe("已封存「Runbook」。");
  });

  it("says how many documents' links stopped working, so the reader is not surprised later", () => {
    expect(archivedDocument("Runbook", 3)).toBe("已封存「Runbook」。3 份文件連到這裡，它們的連結會變成失效。");
    expect(archivedDocument("Runbook", 1)).toContain("1 份文件");
  });

  it("puts the title in the quotes as written, quotes and all", () => {
    expect(archivedDocument('He said "hi"', 0)).toContain('「He said "hi"」');
  });

  it("names what was restored, created, archived and renamed", () => {
    expect(restoredDocument("A")).toBe("已還原「A」。");
    expect(archivedFolder("F")).toBe("已封存資料夾「F」。");
    expect(restoredFolder("F")).toBe("已還原資料夾「F」。");
    expect(createdFolder("F")).toBe("已建立資料夾「F」。");
    expect(renamedFolder("G")).toBe("已重新命名為「G」。");
  });
});

describe("the folder name field", () => {
  it("asks for a name when there is none, blanks included", () => {
    for (const raw of ["", "   ", "\n\t"]) expect(folderNameProblem(raw, 512)).toMatch(/請輸入/);
  });

  it("allows the longest name, counted after trimming, and refuses one more", () => {
    expect(folderNameProblem("x".repeat(512), 512)).toBeNull();
    expect(folderNameProblem(` ${"x".repeat(512)} `, 512)).toBeNull();
    expect(folderNameProblem("x".repeat(513), 512)).toMatch(/512/);
  });

  it("has nothing to say about an ordinary name, in any script", () => {
    for (const name of ["Runbooks", "請假流程", "2026 Q3 / 計畫"]) expect(folderNameProblem(name, 512)).toBeNull();
  });
});

describe("what a refusal means for the reader", () => {
  it.each([
    ["FOLDER_NOT_EMPTY", /先移走或封存/],
    ["INVALID_PARENT", /已不存在|已被封存/],
    ["TREE_CYCLE", /子資料夾/],
    ["CROSS_SOURCE_MOVE", /另一個來源/],
    ["SOURCE_MANAGED_READ_ONLY", /同步管理/],
    ["HUB_MANAGED_OPERATION_REQUIRED", /同步管理/],
    ["SOURCE_ARCHIVED", /請先還原/],
    ["NOT_FOUND", /找不到/],
    ["REQUEST_FAILED", /再試一次/],
  ])("explains %s, and says what to do next where there is something to do", (code, expected) => {
    expect(organizeFailure({ code, message: "server wording" })).toMatch(expected);
    expect(organizeFailure({ code, message: "server wording" })).not.toContain("server wording");
  });

  it("keeps the server's own message for a code it has no sentence for, rather than a vague one", () => {
    expect(organizeFailure({ code: "VALIDATION_ERROR", message: "Folder name must be a non-empty string." })).toBe("Folder name must be a non-empty string.");
  });
});
