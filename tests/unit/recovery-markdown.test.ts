import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildRecoveryMarkdown } from "@/lib/recovery-markdown";
import { parseGenericMarkdownText } from "@/modules/sources/adapters/generic-markdown-folder-adapter";

function parse(text: string) {
  return parseGenericMarkdownText({ sourcePath: "draft.kh-recovery.md", text, sourceFileHash: createHash("sha256").update(text).digest("hex") });
}

describe("recovery downloads", () => {
  it("retains an independent title, non-string metadata and exact body", async () => {
    const output = await buildRecoveryMarkdown({ title: "Project / Notes", markdown: "Body.\n", metadata: { title: 42, owner: "team" } });
    const restored = parse(output.markdown);
    expect(restored.resolvedTitle).toBe("Project / Notes");
    expect(restored.metadata).toEqual({ title: 42, owner: "team" });
    expect(restored.markdown).toBe("Body.\n");
  });

  it("updates a metadata title and keeps the remaining fields", async () => {
    const output = await buildRecoveryMarkdown({ title: "Updated title", markdown: "Body.\n", metadata: { title: "Original", owner: "team" } });
    const restored = parse(output.markdown);
    expect(restored.resolvedTitle).toBe("Updated title");
    expect(restored.metadata).toEqual({ title: "Updated title", owner: "team" });
    expect(restored.markdown).toBe("Body.\n");
  });

  it("keeps an opening heading as the title source", async () => {
    const output = await buildRecoveryMarkdown({ title: "Old title", markdown: "# New heading\n\nBody.\n", metadata: {} });
    const restored = parse(output.markdown);
    expect(restored.resolvedTitle).toBe("New heading");
    expect(restored.titleSource).toBe("H1");
    expect(restored.markdown).toBe("# New heading\n\nBody.\n");
  });
});
