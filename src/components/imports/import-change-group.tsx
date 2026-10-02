"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ImportDiagnosticMessage } from "./import-diagnostic-message";
import { ChevronDown } from "lucide-react";
import type { ImportPreviewChange } from "@/modules/sources/domain/import-plan";

function labelText(change: ImportPreviewChange): string {
  if (change.labels.length === 0) return "Changed";
  return [...change.labels].sort().map(label => label.charAt(0) + label.slice(1).toLowerCase()).join(" + ");
}

export function ImportChangeGroup({
  title,
  changes,
  defaultExpanded,
}: {
  title: string;
  changes: ImportPreviewChange[];
  defaultExpanded: boolean;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [visible, setVisible] = useState(50);
  return (
    <section aria-label={title} className="rounded-md border border-kh-border bg-kh-bg">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-2 rounded-md px-4 py-3 text-left kh-focus-ring focus-visible:ring-inset"
      >
        <h2 className="text-body font-semibold text-kh-text">
          {title} <span className="font-normal text-kh-text-muted">({changes.length})</span>
        </h2>
        <ChevronDown
          size={15}
          aria-hidden="true"
          className={`shrink-0 text-kh-text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded ? (
        changes.length === 0 ? (
          <p className="px-4 pb-4 text-body text-kh-text-muted">No entries in this group.</p>
        ) : (
          <div>
          <ul className="divide-y divide-kh-border border-t border-kh-border">
            {changes.slice(0, visible).map((change) => (
              <li key={`${change.kind.charAt(0) + change.kind.slice(1).toLowerCase()}-${change.sourcePath}`} className="px-4 py-2 text-body">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md border border-kh-border px-1.5 py-0.5 text-caption text-kh-text-muted">
                    {change.kind.charAt(0) + change.kind.slice(1).toLowerCase()}
                  </span>
                  <span className="font-medium text-kh-text">
                    {change.previousPath ? `${change.previousPath} → ${change.sourcePath}` : change.sourcePath}
                  </span>
                  <span className="text-caption text-kh-text-muted">{labelText(change)}</span>
                </div>
                {change.identity ? (
                  <p className="mt-1 break-all text-caption text-kh-text-muted">
                    Identity adopted: <span className="font-medium">{change.identity.adoptedExternalId}</span>
                  </p>
                ) : null}
                {change.diagnostics.length > 0 ? (
                  <ul className="mt-1 list-disc pl-5 text-caption text-kh-text-muted">
                    {change.diagnostics.map((diagnostic, index) => (
                      <li key={`${diagnostic.code}-${index}`}>
                        {diagnostic.severity === "BLOCKING" ? (
                          <span className="font-medium text-kh-danger">Blocker</span>
                        ) : (
                          <span className="font-medium text-kh-warning">Warning</span>
                        )}
                        {": "}
                        <ImportDiagnosticMessage diagnostic={diagnostic} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
          {visible < changes.length ? <div className="border-t border-kh-border px-4 py-2"><Button type="button" variant="secondary" onClick={() => setVisible(count => count + 50)}>Show next {Math.min(50, changes.length - visible)} changes ({visible} of {changes.length})</Button></div> : null}
          </div>
        )
      ) : null}
    </section>
  );
}
