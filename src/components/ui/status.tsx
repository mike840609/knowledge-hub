import { Archive, CircleAlert, CircleCheck, CircleDashed, CircleDot, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A state, said with a glyph and a colour as well as a word.
 *
 * A sync that failed and one that succeeded used to read as the same grey
 * sentence, so a list of sources could only be scanned by reading it. The
 * glyph carries the state at a glance and the word stays beside it, because
 * colour alone is not a message (WCAG 1.4.1) and the word is what a screen
 * reader and a test read.
 *
 * Colour comes from the semantic tokens, which meet 4.5:1 on every surface
 * (§8). `pending` takes the warning colour and `archived` / `none` take muted:
 * an archived document is not a problem, it is a lifecycle state.
 */
export type StatusKind = "success" | "danger" | "pending" | "active" | "archived" | "none";

const KINDS: Record<StatusKind, { Icon: LucideIcon; color: string }> = {
  success: { Icon: CircleCheck, color: "text-kh-success" },
  danger: { Icon: CircleAlert, color: "text-kh-danger" },
  pending: { Icon: CircleDashed, color: "text-kh-warning" },
  active: { Icon: CircleDot, color: "text-kh-success" },
  archived: { Icon: Archive, color: "text-kh-text-muted" },
  none: { Icon: CircleDashed, color: "text-kh-text-muted" },
};

export function StatusIcon({ kind, className = "" }: { kind: StatusKind; className?: string }) {
  const { Icon, color } = KINDS[kind];
  return <Icon aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${color} ${className}`} />;
}

/** The glyph and its word. The word takes the surrounding text colour: only the glyph is coloured. */
export function Status({ kind, children, className = "" }: { kind: StatusKind; children: ReactNode; className?: string }) {
  return (
    <span data-status-kind={kind} className={`inline-flex items-center gap-1 ${className}`}>
      <StatusIcon kind={kind} />
      <span>{children}</span>
    </span>
  );
}
