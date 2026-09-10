import { describe, expect, it } from "vitest";
import {
  assignContiguousPositions,
  collectAncestors,
  normalizeFolderName,
  normalizeTreePosition,
  orderSiblingsByPosition,
  wouldCreateCycle,
} from "@/modules/knowledge/domain/tree-rules";

type MiniNode = { id: string; parentId: string | null; position: number };

describe("pure tree rules", () => {
  it("rejects blank folder names and trims surrounding whitespace", () => {
    expect(normalizeFolderName("  Architecture  ")).toBe("Architecture");
    expect(() => normalizeFolderName("")).toThrowError("Folder name must be a non-empty string.");
    expect(() => normalizeFolderName("   ")).toThrowError("Folder name must be a non-empty string.");
  });

  it("accepts only non-negative safe-integer positions", () => {
    expect(normalizeTreePosition(0)).toBe(0);
    expect(normalizeTreePosition(3)).toBe(3);
    expect(() => normalizeTreePosition(-1)).toThrowError("Tree position must be a non-negative integer.");
    expect(() => normalizeTreePosition(1.5)).toThrowError("Tree position must be a non-negative integer.");
    expect(() => normalizeTreePosition(Number.MAX_SAFE_INTEGER + 1)).toThrowError(
      "Tree position must be a non-negative integer.",
    );
  });

  it("detects self moves and descendant moves as cycles", () => {
    const nodes: MiniNode[] = [
      { id: "root", parentId: null, position: 0 },
      { id: "child", parentId: "root", position: 0 },
      { id: "grandchild", parentId: "child", position: 0 },
      { id: "sibling", parentId: null, position: 1 },
    ];
    expect(wouldCreateCycle(nodes, "root", "root").cycle).toBe(true);
    expect(wouldCreateCycle(nodes, "root", "grandchild").cycle).toBe(true);
    expect(wouldCreateCycle(nodes, "child", "grandchild").cycle).toBe(true);
    expect(wouldCreateCycle(nodes, "grandchild", "root").cycle).toBe(false);
    expect(wouldCreateCycle(nodes, "root", "sibling").cycle).toBe(false);
    expect(wouldCreateCycle(nodes, "root", null).cycle).toBe(false);
  });

  it("carries the precise TREE_CYCLE code on cyclic moves", () => {
    const nodes: MiniNode[] = [
      { id: "root", parentId: null, position: 0 },
      { id: "child", parentId: "root", position: 0 },
    ];
    expect(wouldCreateCycle(nodes, "root", "child").code).toBe("TREE_CYCLE");
    expect(wouldCreateCycle(nodes, "root", "root").code).toBe("TREE_CYCLE");
    expect(wouldCreateCycle(nodes, "child", null).code).toBeNull();
  });

  it("orders siblings contiguously by position then id without fractional indexes", () => {
    const siblings: MiniNode[] = [
      { id: "c", parentId: "p", position: 0 },
      { id: "b", parentId: "p", position: 0 },
      { id: "a", parentId: "p", position: 5 },
    ];
    expect(orderSiblingsByPosition(siblings).map((node) => node.id)).toEqual(["b", "c", "a"]);
    expect(assignContiguousPositions(orderSiblingsByPosition(siblings))).toEqual(
      new Map([
        ["b", 0],
        ["c", 1],
        ["a", 2],
      ]),
    );
  });

  it("collects ancestors root-first without crossing to another parent chain", () => {
    const nodes: MiniNode[] = [
      { id: "root", parentId: null, position: 0 },
      { id: "child", parentId: "root", position: 0 },
      { id: "leaf", parentId: "child", position: 0 },
      { id: "other", parentId: null, position: 1 },
    ];
    expect(collectAncestors(nodes, "leaf").map((node) => node.id)).toEqual(["root", "child"]);
    expect(collectAncestors(nodes, "root")).toEqual([]);
    expect(collectAncestors(nodes, "other")).toEqual([]);
  });
});
