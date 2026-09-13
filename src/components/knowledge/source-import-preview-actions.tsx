"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ImportPreview } from "@/modules/sources/application/reconcile-import-snapshot";

export type ApplyFailure = { code: string; message: string; latchStale: boolean };

const STALE_GUIDANCE = "The preview no longer matches the source. Choose the folder again for a fresh preview.";
const RETRYABLE_GUIDANCE = "A transient database conflict interrupted the apply. Nothing was changed — try again.";
const GENERIC_GUIDANCE = "Applying the import preview failed.";

function readEnvelope(body: unknown): { code: string; message: string } | null {
  if (!body || typeof body !== "object" || !("error" in body)) return null;
  const error = (body as { error: unknown }).error;
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const { code, message } = error as { code: unknown; message?: unknown };
  if (typeof code !== "string" || code.length === 0) return null;
  return { code, message: typeof message === "string" && message.length > 0 ? message : GENERIC_GUIDANCE };
}

/**
 * Design §20.7: branch on the machine-readable `code`, never on the status.
 * Four distinct import codes map to 409 and only `SOURCE_VERSION_CONFLICT` /
 * `IMPORT_SNAPSHOT_STALE` invalidate the snapshot; `IMPORT_APPLY_RETRYABLE`
 * (§17.3) rolled back cleanly, so Apply must stay enabled for a retry.
 * A 409 with no readable envelope keeps the old conservative latch.
 */
export function classifyApplyError(status: number, body: unknown): ApplyFailure {
  const envelope = readEnvelope(body);
  if (!envelope) {
    return status === 409
      ? { code: "IMPORT_APPLY_FAILED", message: STALE_GUIDANCE, latchStale: true }
      : { code: "IMPORT_APPLY_FAILED", message: GENERIC_GUIDANCE, latchStale: false };
  }
  if (envelope.code === "SOURCE_VERSION_CONFLICT" || envelope.code === "IMPORT_SNAPSHOT_STALE") {
    return { code: envelope.code, message: STALE_GUIDANCE, latchStale: true };
  }
  if (envelope.code === "IMPORT_APPLY_RETRYABLE") {
    return { code: envelope.code, message: RETRYABLE_GUIDANCE, latchStale: false };
  }
  return { code: envelope.code, message: envelope.message, latchStale: false };
}

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
      if (!response.ok || !body || typeof body !== "object" || !("sourceId" in body)) {
        const failure = classifyApplyError(response.status, body);
        if (failure.latchStale) setVersionConflict(true);
        setState({ kind: "ERROR", code: failure.code, message: failure.message });
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
