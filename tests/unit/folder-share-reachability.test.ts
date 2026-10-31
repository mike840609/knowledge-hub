import { describe, expect, it } from "vitest";
import { isReachableThroughFolder, type TreeChainNode } from "@/modules/knowledge/domain/document-share-link";

const FOLDER = "folder-1";

function node(id: string, parentId: string | null, nodeType: "FOLDER" | "DOCUMENT" = "FOLDER", status: "ACTIVE" | "ARCHIVED" = "ACTIVE"): TreeChainNode {
  return { id, parentId, nodeType, status };
}

describe("isReachableThroughFolder", () => {
  it("accepts a direct child of the shared folder", () => {
    expect(isReachableThroughFolder([node("doc", FOLDER, "DOCUMENT"), node(FOLDER, null)], FOLDER)).toBe(true);
  });

  it("accepts a grandchild through an active subfolder", () => {
    const chain = [node("doc", "sub", "DOCUMENT"), node("sub", FOLDER), node(FOLDER, "root"), node("root", null)];
    expect(isReachableThroughFolder(chain, FOLDER)).toBe(true);
  });

  it("refuses a document that has been moved out of the folder", () => {
    expect(isReachableThroughFolder([node("doc", "elsewhere", "DOCUMENT"), node("elsewhere", null)], FOLDER)).toBe(false);
  });

  it("refuses an archived document node", () => {
    expect(isReachableThroughFolder([node("doc", FOLDER, "DOCUMENT", "ARCHIVED"), node(FOLDER, null)], FOLDER)).toBe(false);
  });

  it("refuses a chain through an archived intermediate folder", () => {
    const chain = [node("doc", "sub", "DOCUMENT"), node("sub", FOLDER, "FOLDER", "ARCHIVED"), node(FOLDER, null)];
    expect(isReachableThroughFolder(chain, FOLDER)).toBe(false);
  });

  it("refuses when the shared folder itself is archived", () => {
    expect(isReachableThroughFolder([node("doc", FOLDER, "DOCUMENT"), node(FOLDER, null, "FOLDER", "ARCHIVED")], FOLDER)).toBe(false);
  });

  it("refuses a chain that starts at a folder, not a document", () => {
    expect(isReachableThroughFolder([node("sub", FOLDER), node(FOLDER, null)], FOLDER)).toBe(false);
  });

  it("refuses the shared folder asked about as its own document node", () => {
    expect(isReachableThroughFolder([node(FOLDER, null)], FOLDER)).toBe(false);
  });

  it("refuses an empty chain", () => {
    expect(isReachableThroughFolder([], FOLDER)).toBe(false);
  });

  it("refuses a chain whose parents cycle without reaching the folder", () => {
    const chain = [node("doc", "a", "DOCUMENT"), node("a", "b"), node("b", "a"), node("a", "b"), node(FOLDER, null)];
    expect(isReachableThroughFolder(chain, FOLDER)).toBe(false);
  });

  it("refuses a document node that matches the folder id", () => {
    expect(isReachableThroughFolder([node("doc", FOLDER, "DOCUMENT"), node(FOLDER, null, "DOCUMENT")], FOLDER)).toBe(false);
  });
});
