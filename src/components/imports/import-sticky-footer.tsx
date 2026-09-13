"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ImportPreview } from "@/modules/sources/application/reconcile-import-snapshot";

export type ApplyFailure = { code: string; message: string; latchStale: boolean };

const STALE_GUIDANCE = "The preview no longer matches the source. Refresh the preview for a fresh diff.";
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

export function ImportStickyFooter({
  workspaceId,
  preview,
}: {
  workspaceId: string;
  preview: ImportPreview;
}): React.JSX.Element {
  const router = useRouter();
  const [state, setState] = useState<{ kind: "IDLE" } | { kind: "APPLYING" } | { kind: "ERROR"; code: string; message: string }>({ kind: "IDLE" });
  const [versionConflict, setVersionConflict] = useState(false);
  const effectiveState = versionConflict ? "STALE" : preview.state;
  const stale = effectiveState === "STALE" || effectiveState === "APPLIED" || preview.expired;
  const disabled = preview.hasBlockers || stale;
  const cancelHref = preview.sourceId
    ? `/w/${workspaceId}/sources/${preview.sourceId}`
    : `/w/${workspaceId}/sources`;
  const refreshHref = preview.sourceId
    ? `/w/${workspaceId}/sources/${preview.sourceId}/update`
    : `/w/${workspaceId}/sources/import`;

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
      router.push(`/w/${workspaceId}/sources/${sourceId}?import=success`);
    } catch (error) {
      setState({ kind: "ERROR", code: "IMPORT_APPLY_FAILED", message: error instanceof Error ? error.message : GENERIC_GUIDANCE });
    }
  }

  return (
    <div className="sticky bottom-0 -mx-6 border-t border-kh-border bg-kh-bg px-6 py-3">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
        <Link
          href={cancelHref}
          className="rounded-md border border-kh-border bg-kh-bg px-3 py-2 text-sm font-medium text-kh-text transition hover:bg-kh-bg-hover"
        >
          Cancel
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          {stale ? (
            <Link href={refreshHref} className="text-sm font-medium text-kh-accent">
              Refresh preview
            </Link>
          ) : null}
          <button
            type="button"
            disabled={disabled || state.kind === "APPLYING"}
            onClick={() => void apply()}
            className="rounded-md bg-kh-accent px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state.kind === "APPLYING" ? "Applying…" : "Apply changes"}
          </button>
        </div>
      </div>
      {effectiveState === "STALE" || preview.expired ? (
        <p className="mx-auto mt-2 max-w-4xl text-sm text-kh-danger">
          This preview is stale: the source changed after it was created. There is no Force Apply — create a fresh
          preview.
        </p>
      ) : null}
      {effectiveState === "APPLIED" ? (
        <p className="mx-auto mt-2 max-w-4xl text-sm text-kh-text-muted">This preview was already applied.</p>
      ) : null}
      {state.kind === "ERROR" ? (
        <p role="alert" className="mx-auto mt-2 max-w-4xl text-sm text-kh-danger">
          {state.code}: {state.message}
        </p>
      ) : null}
    </div>
  );
}
