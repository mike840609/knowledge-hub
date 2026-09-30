import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { exportMarkdown, exportName, exportZip } from "@/lib/markdown-export";
describe("portable Markdown export", () => {
  it("preserves metadata and emits the current title and unchanged body", () => {
    const text = exportMarkdown({ title: "中文: note", markdown: "# Body\n\n[[Link]]", metadata: { title: "old", tags: ["工作"], nested: { x: 1 } } });
    const [, yaml, body] = text.split("---\n");
    expect(parse(yaml)).toEqual({ title: "中文: note", tags: ["工作"], nested: { x: 1 } });
    expect(body).toBe("\n# Body\n\n[[Link]]");
  });
  it("prevents traversal and duplicate-title collisions", () => {
    expect(exportName("../../bad\\name", "id1")).not.toMatch(/[/\\]/);
    expect(exportName("same", "id1")).not.toBe(exportName("same", "id2"));
    expect(() => exportZip([{ path: "../escape.md", content: "bad" }])).toThrow("Unsafe");
  });
  it("writes ZIP records with UTF-8 names, byte lengths, CRC and central directory offsets", () => {
    const path = "資料/筆記.md"; const content = "# 你好\n";
    const zip = Buffer.from(exportZip([{ path, content }]));
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt16LE(6)).toBe(0x800);
    const length = Buffer.byteLength(content); const nameLength = Buffer.byteLength(path);
    expect(zip.readUInt32LE(18)).toBe(length);
    expect(zip.subarray(30, 30 + nameLength).toString()).toBe(path);
    expect(zip.subarray(30 + nameLength, 30 + nameLength + length).toString()).toBe(content);
    const end = zip.length - 22; const central = zip.readUInt32LE(end + 16);
    expect(zip.readUInt32LE(central)).toBe(0x02014b50);
    expect(zip.readUInt32LE(central + 16)).toBe(zip.readUInt32LE(14));
    expect(zip.readUInt32LE(central + 42)).toBe(0);
  });
});
