import { expect, it } from "vitest";
import { defaultDocumentEditing } from "@/lib/default-document-editing";

const personalNote = {
  canEdit: true, workspaceType: "PERSONAL", lifecycleState: "ACTIVE",
  sourceType: "HUB", sourceStatus: "ACTIVE", includeArchived: false,
};
it("opens writable personal Hub notes directly in the editor", () => {
  expect(defaultDocumentEditing(personalNote)).toBe(true);
});
it.each([
  { sourceType: "FOLDER_SYNC" }, { workspaceType: "TEAM" },
  { canEdit: false }, { lifecycleState: "ARCHIVED" }, { sourceStatus: "ARCHIVED" },
  { mode: "read" }, { revision: "1" }, { graph: "2" }, { includeArchived: true },
])("preserves reading for %j", (override) => {
  expect(defaultDocumentEditing({ ...personalNote, ...override })).toBe(false);
});
