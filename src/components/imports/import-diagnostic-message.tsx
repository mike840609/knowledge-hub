import type { ImportDiagnostic } from "@/modules/sources/domain/import-diagnostic";

/** Human guidance leads; machine codes remain available for investigation. */
export function ImportDiagnosticMessage({ diagnostic }: { diagnostic: ImportDiagnostic }) {
  return <div className="space-y-1">
    <p>{diagnostic.message}</p>
    <details className="text-caption text-kh-text-muted">
      <summary className="cursor-pointer rounded-md kh-focus-ring">Technical details</summary>
      <code className="break-all">{diagnostic.code}</code>
      {diagnostic.details ? <pre className="overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(diagnostic.details, null, 2)}</pre> : null}
    </details>
  </div>;
}
