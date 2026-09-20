"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ImportPreviewChange } from "@/modules/sources/domain/import-plan";

function labelText(change: ImportPreviewChange): string {
  if (change.labels.length === 0) return "Changed";
  return [...change.labels].sort().join(" + ");
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
  return (
    <section aria-label={title} className="rounded-md border border-kh-border bg-kh-bg">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-2 rounded-md px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-kh-focus"
      >
        <h2 className="text-body font-semibold text-kh-text">
          {title} <span className="font-normal text-kh-text-muted">({changes.length})</span>
        </h2>
        <ChevronDown
          size={15}
          strokeWidth={2}
          aria-hidden="true"
          className={`shrink-0 text-kh-text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded ? (
        changes.length === 0 ? (
          <p className="px-4 pb-4 text-body text-kh-text-muted">No entries in this group.</p>
        ) : (
          <ul className="divide-y divide-kh-border border-t border-kh-border">
            {changes.map((change) => (
              <li key={`${change.kind}-${change.sourcePath}`} className="px-4 py-2 text-body">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md border border-kh-border px-1.5 py-0.5 text-caption text-kh-text-muted">
                    {change.kind}
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
                        {diagnostic.code} — {diagnostic.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
