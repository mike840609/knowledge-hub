"use client";
import { useEffect, useRef, useState } from "react";
import type { ImportContentDiff as Diff } from "@/modules/sources/domain/import-content-diff";
import { Button } from "@/components/ui/button";
export function ImportContentDiff({
  snapshotId,
  sourcePath,
}: {
  snapshotId: string;
  sourcePath: string;
}) {
  const [expanded, setExpanded] = useState(false),
    [diff, setDiff] = useState<Diff | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const [visibleLines, setVisibleLines] = useState(100);
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
    },
    [],
  );
  async function load() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/source-imports/${encodeURIComponent(snapshotId)}/diff?path=${encodeURIComponent(sourcePath)}`,
        { signal: controller.signal, cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message ?? "Unable to load changes.");
      if (!controller.signal.aborted) setDiff(body);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Unable to load changes.");
    } finally {
      if (active.current === controller) active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <div className="mt-2">
      <Button
        type="button"
        variant="link"
        aria-label={`View changes: ${sourcePath}`}
        aria-expanded={expanded}
        onClick={() => {
          setExpanded(!expanded);
          if (!expanded && !diff) void load();
        }}
      >
        {expanded ? "Hide changes" : "View changes"}
      </Button>
      {expanded ? (
        <div className="mt-2 rounded-md border border-kh-border bg-kh-bg-raised p-3">
          {busy ? (
            <p role="status" className="text-caption text-kh-text-muted">
              Loading changes…
            </p>
          ) : null}
          {error ? (
            <div role="alert">
              <p>{error}</p>
              <Button type="button" variant="link" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          ) : null}
          {diff ? (
            <>
              {diff.titleChanges ? (
                <p className="mb-2 text-body">
                  <strong>Title:</strong> {diff.titleChanges.before ?? "(none)"}{" "}
                  → {diff.titleChanges.after ?? "(none)"}
                </p>
              ) : null}
              {diff.metadataChanges.length ? (
                <dl className="mb-3 text-caption">
                  {diff.metadataChanges.map((m) => (
                    <div key={m.key} className="break-all">
                      <dt className="font-medium">{m.key}</dt>
                      <dd>
                        {m.before ?? "(none)"} → {m.after ?? "(none)"}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {diff.truncated ? (
                <p className="mb-2 text-caption text-kh-warning">
                  This diff is truncated to keep the preview responsive. Large
                  changes are shown as bounded before/after text.
                </p>
              ) : null}
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-caption">
                {diff.lines.slice(0, visibleLines).map((line, i) => (
                  <span
                    key={i}
                    className={`block ${line.kind === "added" ? "bg-kh-bg-selected text-kh-selected-text" : line.kind === "removed" ? "text-kh-danger" : "text-kh-text-muted"}`}
                  >
                    <span aria-label={line.kind}>
                      {line.kind === "added"
                        ? "+"
                        : line.kind === "removed"
                          ? "−"
                          : " "}
                    </span>{" "}
                    {line.text}
                  </span>
                ))}
              </pre>
              {visibleLines < diff.lines.length ? (
                <Button type="button" variant="secondary" onClick={() => setVisibleLines(count => count + 100)}>
                  Show more changed lines
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
