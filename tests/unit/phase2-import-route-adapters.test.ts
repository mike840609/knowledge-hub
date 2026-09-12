import { describe, expect, it } from "vitest";
import {
  parseInitialImportBody,
  parseResyncImportBody,
  parseUploadBatchSpecs,
} from "@/server/import-route-adapters";

function markdownFile(name: string, text: string): File {
  return new File([text], name, { type: "text/markdown" });
}

function multipart(specs: unknown, files: Record<string, File | string> = {}): FormData {
  const form = new FormData();
  if (specs !== undefined) form.set("entries", typeof specs === "string" ? specs : JSON.stringify(specs));
  for (const [field, value] of Object.entries(files)) form.set(field, value);
  return form;
}

describe("Phase 2 multipart upload route adapter", () => {
  it("parses well-formed specs into upload keys and File parts", () => {
    const form = multipart(
      [{ uploadKey: "m1", field: "f0" }],
      { f0: markdownFile("a.md", "# A\n") },
    );

    const parsed = parseUploadBatchSpecs(form);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].uploadKey).toBe("m1");
    expect(parsed[0].field).toBe("f0");
    expect(parsed[0].file).toBeInstanceOf(File);
    expect(parsed[0].file.name).toBe("a.md");
  });

  it("rejects a missing or non-JSON entries part", () => {
    expect(() => parseUploadBatchSpecs(new FormData())).toThrowError(
      expect.objectContaining({ code: "INVALID_UPLOAD_BATCH" }),
    );
    expect(() => parseUploadBatchSpecs(multipart("not-json", { f0: markdownFile("a.md", "# A\n") }))).toThrowError(
      expect.objectContaining({ code: "INVALID_UPLOAD_BATCH" }),
    );
  });

  it("rejects entries that are valid JSON but not an array of specs", () => {
    for (const specs of ['"just-a-string"', "42", "{}", "null", '[{ "uploadKey": "m1" }]']) {
      expect(() => parseUploadBatchSpecs(multipart(specs, { f0: markdownFile("a.md", "# A\n") }))).toThrowError(
        expect.objectContaining({ code: "INVALID_UPLOAD_BATCH" }),
      );
    }
  });

  it("rejects specs with missing or empty uploadKey and field", () => {
    const bad = [
      [{ field: "f0" }],
      [{ uploadKey: "m1" }],
      [{ uploadKey: "", field: "f0" }],
      [{ uploadKey: "m1", field: "" }],
      [{ uploadKey: 42, field: "f0" }],
      [null],
    ];
    for (const specs of bad) {
      expect(() => parseUploadBatchSpecs(multipart(specs, { f0: markdownFile("a.md", "# A\n") }))).toThrowError(
        expect.objectContaining({ code: "INVALID_UPLOAD_BATCH" }),
      );
    }
  });

  it("rejects duplicate upload keys", () => {
    const form = multipart(
      [
        { uploadKey: "m1", field: "f0" },
        { uploadKey: "m1", field: "f1" },
      ],
      { f0: markdownFile("a.md", "# A\n"), f1: markdownFile("b.md", "# B\n") },
    );

    expect(() => parseUploadBatchSpecs(form)).toThrowError(
      expect.objectContaining({ code: "INVALID_UPLOAD_BATCH" }),
    );
  });

  it("rejects duplicate fields", () => {
    const form = multipart(
      [
        { uploadKey: "m1", field: "f0" },
        { uploadKey: "m2", field: "f0" },
      ],
      { f0: markdownFile("a.md", "# A\n") },
    );

    expect(() => parseUploadBatchSpecs(form)).toThrowError(
      expect.objectContaining({ code: "INVALID_UPLOAD_BATCH" }),
    );
  });

  it("rejects a field that has no matching File part", () => {
    const missing = multipart([{ uploadKey: "m1", field: "f0" }]);
    expect(() => parseUploadBatchSpecs(missing)).toThrowError(
      expect.objectContaining({ code: "INVALID_UPLOAD_BATCH" }),
    );

    const textPart = multipart([{ uploadKey: "m1", field: "f0" }], { f0: "not-a-file" });
    expect(() => parseUploadBatchSpecs(textPart)).toThrowError(
      expect.objectContaining({ code: "INVALID_UPLOAD_BATCH" }),
    );
  });
});

describe("Phase 2 JSON session route adapters", () => {
  it("passes a well-formed initial import body through untouched", () => {
    const body = { sourceName: "Wiki", rootName: "wiki", manifest: [], extra: "ignored" };

    expect(parseInitialImportBody(body)).toEqual({ sourceName: "Wiki", rootName: "wiki", manifest: [] });
  });

  it("rejects non-object initial import bodies", () => {
    for (const body of [null, undefined, "{}", 42, ["sourceName"], []]) {
      expect(() => parseInitialImportBody(body)).toThrowError(
        expect.objectContaining({ code: "INVALID_IMPORT_MANIFEST" }),
      );
    }
  });

  it("passes a well-formed resync body through untouched", () => {
    expect(parseResyncImportBody({ rootName: "wiki", manifest: [] })).toEqual({ rootName: "wiki", manifest: [] });
  });

  it("rejects non-object resync bodies", () => {
    for (const body of [null, undefined, "{}", 7, [{ rootName: "wiki" }]]) {
      expect(() => parseResyncImportBody(body)).toThrowError(
        expect.objectContaining({ code: "INVALID_IMPORT_MANIFEST" }),
      );
    }
  });
});
