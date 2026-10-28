import { describe, expect, it } from "vitest";
import { duplicateMarkdown, duplicateTitle } from "@/lib/duplicate-document";

describe("duplicating a document", () => {
  it("names the copy so it can be told apart in the tree", () => {
    expect(duplicateTitle("Onboarding")).toBe("Onboarding copy");
    expect(duplicateTitle("  Onboarding  ")).toBe("Onboarding copy");
    expect(duplicateTitle("")).toBe("Untitled document copy");
  });

  it("gives up title characters rather than the suffix at the 512-character limit", () => {
    const title = duplicateTitle("x".repeat(512));
    expect(title).toHaveLength(512);
    expect(title.endsWith(" copy")).toBe(true);
  });

  it("renames an opening H1, because that is the title the reader sees", () => {
    expect(duplicateMarkdown("# Onboarding\n\nBody.", "Onboarding copy")).toBe("# Onboarding copy\n\nBody.");
  });

  it("leaves content alone when the title is not the opening H1", () => {
    expect(duplicateMarkdown("Body only.", "Body only copy")).toBe("Body only.");
    expect(duplicateMarkdown("## Section\n\nBody.", "Section copy")).toBe("## Section\n\nBody.");
  });
});
