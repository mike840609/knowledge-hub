/**
 * Words for folder-sync codes, shared by the import preview, the sync run page and the
 * server read model. Free of React and server imports so any of them can use it.
 */

/** Stored change labels ("ADDED", "MOVED") as words: "Added + Moved". */
export function changeLabelText(labels: readonly string[]): string {
  if (labels.length === 0) return "Changed";
  return [...labels].sort().map((label) => label.charAt(0) + label.slice(1).toLowerCase()).join(" + ");
}

/** Who started a run when their identity no longer resolves; never the raw id. */
export const UNKNOWN_RUN_ACTOR = "an unknown user";
