import { describe, expect, it } from "vitest";
import {
  alreadyAtEdge,
  archivedDocument,
  archivedFolder,
  createdFolder,
  folderNameProblem,
  movedNode,
  organizeFailure,
  renamedFolder,
  reorderedNode,
  restoredDocument,
  restoredFolder,
} from "@/components/knowledge/organize-messages";

describe("what an archive says", () => {
  it("names the document, and says nothing more when nothing linked to it", () => {
    expect(archivedDocument("Runbook", 0)).toBe("Archived “Runbook”.");
    expect(archivedDocument("Runbook", null)).toBe("Archived “Runbook”.");
  });

  it("says how many documents' links stopped working, so the reader is not surprised later", () => {
    expect(archivedDocument("Runbook", 3)).toBe("Archived “Runbook”. 3 documents link here; those links will stop working.");
  });

  it("says it in the singular for one document", () => {
    expect(archivedDocument("Runbook", 1)).toBe("Archived “Runbook”. 1 document links here; that link will stop working.");
  });

  it("puts the title in the quotes as written, quotes and all", () => {
    expect(archivedDocument('He said "hi"', 0)).toContain('“He said "hi"”');
  });

  it("names what was restored, created, archived and renamed", () => {
    expect(restoredDocument("A")).toBe("Restored “A”.");
    expect(archivedFolder("F")).toBe("Archived folder “F”.");
    expect(restoredFolder("F")).toBe("Restored folder “F”.");
    expect(createdFolder("F")).toBe("Created folder “F”.");
    expect(renamedFolder("G")).toBe("Renamed to “G”.");
  });
});

describe("what a move says", () => {
  it("names where it went, and says the top level in words because it has no name", () => {
    expect(movedNode("Runbook", "Projects")).toBe("Moved “Runbook” to “Projects”.");
    expect(movedNode("Runbook", null)).toBe("Moved “Runbook” to the top level.");
  });

  it("says a reorder by direction and by where the node is now, counting from one", () => {
    expect(reorderedNode("Runbook", "up", 0, 5)).toBe("Moved “Runbook” up. Position 1 of 5.");
    expect(reorderedNode("Runbook", "down", 3, 5)).toBe("Moved “Runbook” down. Position 4 of 5.");
  });

  it("says when there was nowhere further to go", () => {
    expect(alreadyAtEdge("Runbook", "first")).toBe("“Runbook” is already first.");
    expect(alreadyAtEdge("Runbook", "last")).toBe("“Runbook” is already last.");
  });
});

describe("the folder name field", () => {
  it("asks for a name when there is none, blanks included", () => {
    for (const raw of ["", "   ", "\n\t"]) expect(folderNameProblem(raw, 512)).toMatch(/Enter a folder name/);
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
    ["FOLDER_NOT_EMPTY", /Move or archive what's inside first/],
    ["INVALID_PARENT", /no longer exists|archived/],
    ["TREE_CYCLE", /itself or one of its subfolders/],
    ["CROSS_SOURCE_MOVE", /another source/],
    ["SOURCE_MANAGED_READ_ONLY", /managed by sync/],
    ["HUB_MANAGED_OPERATION_REQUIRED", /managed by sync/],
    ["SOURCE_ARCHIVED", /Restore it first/],
    ["NOT_FOUND", /can't be found/],
    ["REQUEST_FAILED", /try again/],
  ])("explains %s, and says what to do next where there is something to do", (code, expected) => {
    expect(organizeFailure({ code, message: "server wording" })).toMatch(expected);
    expect(organizeFailure({ code, message: "server wording" })).not.toContain("server wording");
  });

  it("keeps the server's own message for a code it has no sentence for, rather than a vague one", () => {
    expect(organizeFailure({ code: "VALIDATION_ERROR", message: "Folder name must be a non-empty string." })).toBe("Folder name must be a non-empty string.");
  });
});
