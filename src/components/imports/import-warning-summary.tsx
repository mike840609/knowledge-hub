import type { ImportPreview } from "@/modules/sources/application/reconcile-import-snapshot";

export function ImportWarningSummary({ preview }: { preview: ImportPreview }): React.JSX.Element | null {
  const blockers = preview.changes.flatMap((change) =>
    change.diagnostics
      .filter((diagnostic) => diagnostic.severity === "BLOCKING")
      .map((diagnostic) => ({ ...diagnostic, sourcePath: change.sourcePath })),
  );
  const warnings = preview.changes.flatMap((change) =>
    change.diagnostics
      .filter((diagnostic) => diagnostic.severity === "WARNING")
      .map((diagnostic) => ({ ...diagnostic, sourcePath: change.sourcePath })),
  );
  if (blockers.length === 0 && warnings.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {blockers.length > 0 ? (
        <section
          aria-labelledby="import-blockers-heading"
          className="rounded-md border border-kh-danger/40 bg-kh-bg p-4"
        >
          <h2 id="import-blockers-heading" className="text-sm font-semibold text-kh-danger">
            Blockers ({blockers.length}) — fix the source folder and create a fresh preview
          </h2>
          <ul className="mt-2 list-disc pl-5 text-sm text-kh-text">
            {blockers.map((diagnostic, index) => (
              <li key={`${diagnostic.code}-${diagnostic.sourcePath}-${index}`}>
                <span className="font-medium">{diagnostic.code}</span> at {diagnostic.sourcePath}: {diagnostic.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {warnings.length > 0 ? (
        <section
          aria-labelledby="import-warnings-heading"
          className="rounded-md border border-kh-warning/40 bg-kh-bg p-4"
        >
          <h2 id="import-warnings-heading" className="text-sm font-semibold text-kh-warning">
            Warnings ({warnings.length}) — review, then Apply may proceed
          </h2>
          <ul className="mt-2 list-disc pl-5 text-sm text-kh-text">
            {warnings.map((diagnostic, index) => (
              <li key={`${diagnostic.code}-${diagnostic.sourcePath}-${index}`}>
                <span className="font-medium">{diagnostic.code}</span> at {diagnostic.sourcePath}: {diagnostic.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
