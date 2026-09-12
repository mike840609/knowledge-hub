"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ImportPreview } from "@/modules/sources/application/reconcile-import-snapshot";

export function SourceImportPreviewActions({ preview }: { preview: ImportPreview }) {
  const router = useRouter();
  const [state, setState] = useState<{ kind: "IDLE" } | { kind: "APPLYING" } | { kind: "ERROR"; code: string; message: string }>({ kind: "IDLE" });
  const [versionConflict, setVersionConflict] = useState(false);
  const effectiveState = versionConflict ? "STALE" : preview.state;
  const disabled = preview.hasBlockers || preview.expired || effectiveState === "STALE" || effectiveState === "APPLIED";
  const resyncHref = preview.sourceId
    ? `/knowledge?workspaceId=${preview.workspaceId}&sourceId=${preview.sourceId}`
    : `/knowledge?workspaceId=${preview.workspaceId}`;

  async function apply(): Promise<void> {
    setState({ kind: "APPLYING" });
    try {
      const response = await fetch(`/api/source-imports/${preview.snapshotId}/apply`, { method: "POST" });
      const body = await response.json().catch(() => null);
      if (response.status === 409) {
        setVersionConflict(true);
        setState({ kind: "ERROR", code: "SOURCE_VERSION_CONFLICT", message: "The source changed after this preview was created. Choose the folder again for a fresh preview." });
        return;
      }
      if (!response.ok || !body || typeof body !== "object" || !("sourceId" in body)) {
        const error = body && typeof body === "object" && "error" in body
          ? (body as { error: { code?: unknown; message?: unknown } }).error
          : null;
        setState({
          kind: "ERROR",
          code: typeof error?.code === "string" ? error.code : "IMPORT_APPLY_FAILED",
          message: typeof error?.message === "string" ? error.message : "Applying the import preview failed.",
        });
        return;
      }
      const sourceId = (body as { sourceId: string }).sourceId;
      router.push(`/knowledge?workspaceId=${preview.workspaceId}&sourceId=${sourceId}`);
    } catch (error) {
      setState({ kind: "ERROR", code: "IMPORT_APPLY_FAILED", message: error instanceof Error ? error.message : "Applying the import preview failed." });
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={disabled || state.kind === "APPLYING"}
          onClick={() => void apply()}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.kind === "APPLYING" ? "Applying…" : "Confirm and apply"}
        </button>
        <Link className="text-sm font-medium text-accent" href={resyncHref}>Choose folder again</Link>
      </div>
      {effectiveState === "STALE" ? <p className="mt-2 text-sm text-red-700">This preview is stale: the source changed after it was created. There is no Force Apply — create a fresh preview.</p> : null}
      {effectiveState === "APPLIED" ? <p className="mt-2 text-sm text-slate-600">This preview was already applied.</p> : null}
      {state.kind === "ERROR" ? <p role="alert" className="mt-2 text-sm text-red-700">{state.code}: {state.message}</p> : null}
    </div>
  );
}
