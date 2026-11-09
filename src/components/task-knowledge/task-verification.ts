import type { StatusKind } from "@/components/ui/status";

const VERIFICATION_LABELS: Record<string, string> = {
  passed: "Passed",
  failed: "Failed",
  not_run: "Not run",
  not_applicable: "Not applicable",
};

/** The word a reader sees for an Agent-reported verification status. */
export const verificationLabel = (status: string) => VERIFICATION_LABELS[status] ?? status;

/** The glyph colour for the same status; a missing run is neutral, not a failure. */
export function verificationKind(status: string): StatusKind {
  if (status === "passed") return "success";
  if (status === "failed") return "danger";
  return "none";
}
