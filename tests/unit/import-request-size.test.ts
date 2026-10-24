import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BATCH_BYTES } from "@/lib/upload-limits";

describe("folder-import request size", () => {
  it("keeps a full multipart batch under Vercel's 4.5 MB function cap", async () => {
    const form = new FormData();
    const entries: { uploadKey: string; field: string }[] = [];
    const perFile = Math.floor(MAX_UPLOAD_BATCH_BYTES / 20);
    for (let index = 0; index < 20; index += 1) {
      entries.push({ uploadKey: `key-${index}`, field: `file-${index}` });
      form.set(`file-${index}`, new File(["a".repeat(perFile)], `note-${index}.md`, { type: "text/markdown" }));
    }
    form.set("entries", JSON.stringify(entries));

    const body = await new Response(form).arrayBuffer();
    expect(body.byteLength).toBeLessThan(4_500_000);
  });
});
