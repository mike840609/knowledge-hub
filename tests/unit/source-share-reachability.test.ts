import { describe, expect, it } from "vitest";
import { isReachableThroughSource, type TreeChainNode } from "@/modules/knowledge/domain/document-share-link";
import { documentReachesSource } from "@/modules/knowledge/application/internal/folder-link-reach";

const SOURCE = "source-1";

function node(
  id: string,
  parentId: string | null,
  nodeType: "FOLDER" | "DOCUMENT" = "DOCUMENT",
  status: "ACTIVE" | "ARCHIVED" = "ACTIVE",
  sourceId: string = SOURCE,
): TreeChainNode {
  return { id, sourceId, parentId, nodeType, status };
}

describe("isReachableThroughSource", () => {
  it("accepts a top-level document whose only node has a null parent", () => {
    expect(isReachableThroughSource([node("d", null)], SOURCE)).toBe(true);
  });

  it("accepts a nested document with every ancestor ACTIVE and in the same Source", () => {
    const chain = [node("doc", "sub"), node("sub", "root", "FOLDER"), node("root", null, "FOLDER")];
    expect(isReachableThroughSource(chain, SOURCE)).toBe(true);
  });

  it("refuses a chain that never reaches a root (a truncated read)", () => {
    const chain = [node("doc", "sub"), node("sub", "root", "FOLDER"), node("root", "above", "FOLDER")];
    expect(isReachableThroughSource(chain, SOURCE)).toBe(false);
  });

  it("refuses an archived document node", () => {
    expect(isReachableThroughSource([node("doc", null, "DOCUMENT", "ARCHIVED")], SOURCE)).toBe(false);
  });

  it("refuses an archived intermediate folder", () => {
    expect(isReachableThroughSource([node("doc", "sub"), node("sub", null, "FOLDER", "ARCHIVED")], SOURCE)).toBe(false);
  });

  it("refuses a node in another Source", () => {
    expect(isReachableThroughSource([node("doc", "sub"), node("sub", null, "FOLDER", "ACTIVE", "other")], SOURCE)).toBe(false);
    expect(isReachableThroughSource([node("doc", null, "DOCUMENT", "ACTIVE", "other")], SOURCE)).toBe(false);
  });

  it("refuses an empty chain", () => {
    expect(isReachableThroughSource([], SOURCE)).toBe(false);
  });

  it("refuses a repeated id cycle", () => {
    const chain = [node("doc", "a"), node("a", "b", "FOLDER"), node("b", "a", "FOLDER"), node("a", null, "FOLDER")];
    expect(isReachableThroughSource(chain, SOURCE)).toBe(false);
  });

  it("refuses a chain that starts at a folder, not a document", () => {
    expect(isReachableThroughSource([node("root", null, "FOLDER")], SOURCE)).toBe(false);
  });
});

describe("documentReachesSource", () => {
  const source = { id: SOURCE, status: "ACTIVE" as const };
  const document = { sourceId: SOURCE, status: "ACTIVE" as const };

  it("is true only for an ACTIVE document of the Source whose chain reaches a Source root", () => {
    const chain = [node("doc", null)];
    expect(documentReachesSource(source, document, chain)).toBe(true);
    expect(documentReachesSource({ ...source, status: "ARCHIVED" }, document, chain)).toBe(false);
    expect(documentReachesSource(source, { ...document, status: "ARCHIVED" }, chain)).toBe(false);
    expect(documentReachesSource(source, { ...document, sourceId: "other" }, chain)).toBe(false);
    expect(documentReachesSource(source, document, undefined)).toBe(false);
    expect(documentReachesSource(source, document, [node("doc", "above")])).toBe(false);
    expect(documentReachesSource(source, document, [node("doc", "sub"), node("sub", null, "FOLDER", "ARCHIVED")])).toBe(false);
  });
});
