/** Only current, writable personal Hub notes open in the editor by default. */
export function defaultDocumentEditing(input: {
  canEdit: boolean;
  workspaceType?: string;
  lifecycleState?: string;
  sourceType?: string;
  sourceStatus?: string;
  mode?: string;
  revision?: string;
  graph?: string;
  includeArchived: boolean;
}): boolean {
  return input.canEdit && input.workspaceType === "PERSONAL" &&
    input.lifecycleState === "ACTIVE" && input.sourceType === "HUB" &&
    input.sourceStatus === "ACTIVE" && input.mode !== "read" &&
    input.revision === undefined && input.graph === undefined && !input.includeArchived;
}
