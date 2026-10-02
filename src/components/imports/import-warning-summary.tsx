"use client";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ImportDiagnosticMessage } from "./import-diagnostic-message";
import type { ImportPreview } from "@/modules/sources/application/reconcile-import-snapshot";

export function ImportWarningSummary({ preview }: { preview: ImportPreview }): React.JSX.Element | null {
  const [visibleBlockers, setVisibleBlockers] = useState(50);
  const [visibleWarnings, setVisibleWarnings] = useState(50);
  const blockers = useMemo(() => preview.changes.flatMap((change) =>
    change.diagnostics
      .filter((diagnostic) => diagnostic.severity === "BLOCKING")
      .map((diagnostic) => ({ ...diagnostic, sourcePath: change.sourcePath })),
  ), [preview.changes]);
  const warnings = useMemo(() => preview.changes.flatMap((change) =>
    change.diagnostics
      .filter((diagnostic) => diagnostic.severity === "WARNING")
      .map((diagnostic) => ({ ...diagnostic, sourcePath: change.sourcePath })),
  ), [preview.changes]);
  if (blockers.length === 0 && warnings.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {blockers.length > 0 ? (
        <section
          aria-labelledby="import-blockers-heading"
          className="rounded-md border border-kh-danger/40 bg-kh-bg p-4"
        >
          <h2 id="import-blockers-heading" className="text-body font-semibold text-kh-danger">
            Blockers ({blockers.length}) — fix the source folder and create a fresh preview
          </h2>
          <ul className="mt-2 list-disc pl-5 text-body text-kh-text">
            {blockers.slice(0, visibleBlockers).map((diagnostic, index) => (
              <li key={`${diagnostic.code}-${diagnostic.sourcePath}-${index}`}>
                <p className="break-all font-medium">{diagnostic.sourcePath}</p>
                <ImportDiagnosticMessage diagnostic={diagnostic} />
              </li>
            ))}
          </ul>
          {visibleBlockers < blockers.length ? <Button type="button" variant="secondary" className="mt-2" onClick={() => setVisibleBlockers(count => count + 50)}>Show more blockers ({visibleBlockers} of {blockers.length})</Button> : null}
        </section>
      ) : null}
      {warnings.length > 0 ? (
        <section
          aria-labelledby="import-warnings-heading"
          className="rounded-md border border-kh-warning/40 bg-kh-bg p-4"
        >
          <h2 id="import-warnings-heading" className="text-body font-semibold text-kh-warning">
            Warnings ({warnings.length}) — review, then Apply may proceed
          </h2>
          <ul className="mt-2 list-disc pl-5 text-body text-kh-text">
            {warnings.slice(0, visibleWarnings).map((diagnostic, index) => (
              <li key={`${diagnostic.code}-${diagnostic.sourcePath}-${index}`}>
                <p className="break-all font-medium">{diagnostic.sourcePath}</p>
                <ImportDiagnosticMessage diagnostic={diagnostic} />
              </li>
            ))}
          </ul>
          {visibleWarnings < warnings.length ? <Button type="button" variant="secondary" className="mt-2" onClick={() => setVisibleWarnings(count => count + 50)}>Show more warnings ({visibleWarnings} of {warnings.length})</Button> : null}
        </section>
      ) : null}
    </div>
  );
}
