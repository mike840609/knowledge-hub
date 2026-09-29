/**
 * The link index is filled by a repair pass after the migration and kept
 * current by every save. Until it is complete, an empty list of backlinks means
 * "not known yet", not "nothing links here"; this says which.
 */
export function LinkIndexNote({ stale }: { stale: number }) {
  if (stale <= 0) return null;
  return (
    <p role="status" className="rounded-md border border-kh-warning-border bg-kh-warning-bg px-3 py-2 text-body-sm text-kh-warning">
      Link index is updating ({stale} {stale === 1 ? "document" : "documents"}). Backlinks may be incomplete.
    </p>
  );
}
