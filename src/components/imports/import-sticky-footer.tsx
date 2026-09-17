"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { requestWorkspaceAccessCheck, useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { useEffect, useState } from "react";
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
 * Source/version/identity conflicts and unsupported plans require a fresh
 * preview; `IMPORT_APPLY_RETRYABLE`
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
  if (["SOURCE_VERSION_CONFLICT", "IMPORT_SNAPSHOT_STALE", "IDENTITY_STATE_CHANGED", "IMPORT_PLAN_VERSION_UNSUPPORTED"].includes(envelope.code)) {
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
  const { access, confirmed } = useWorkspaceAuthorization();
  const allowed = confirmed && access.actions.canImport;
  const [state, setState] = useState<{ kind: "IDLE" } | { kind: "APPLYING" } | { kind: "ERROR"; code: string; message: string }>({ kind: "IDLE" });
  const [versionConflict, setVersionConflict] = useState(false);
  const [expired, setExpired] = useState(preview.expired);
  useEffect(() => {
    const remaining = new Date(preview.expiresAt).getTime() - Date.now();
    setExpired(preview.expired || remaining <= 0);
    const timer = setTimeout(() => setExpired(true), Math.max(0, Math.min(remaining, 2_147_483_647)));
    return () => clearTimeout(timer);
  }, [preview.expired, preview.expiresAt]);
  const effectiveState = versionConflict ? "STALE" : preview.state;
  const stale = effectiveState === "STALE" || effectiveState === "APPLIED" || expired;
  const disabled = !allowed || preview.hasBlockers || stale || effectiveState !== "READY";
  const cancelHref = preview.sourceId
    ? `/w/${workspaceId}/sources/${preview.sourceId}`
    : `/w/${workspaceId}/sources`;
  const refreshHref = preview.sourceId
    ? `/w/${workspaceId}/sources/${preview.sourceId}/update`
    : `/w/${workspaceId}/sources/import`;

  async function apply(): Promise<void> {
    if (disabled || state.kind === "APPLYING" || new Date(preview.expiresAt).getTime() <= Date.now()) return;
    setState({ kind: "APPLYING" });
    try {
      const response = await fetch(`/api/source-imports/${preview.snapshotId}/apply`, { method: "POST" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body || typeof body !== "object" || !("sourceId" in body)) {
        requestWorkspaceAccessCheck(response.status);
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
          className="rounded-md border border-kh-border bg-kh-bg px-3 py-2 text-sm font-medium text-kh-text transition hover:bg-kh-bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-focus"
        >
          Cancel
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          {stale && allowed ? (
            <Link href={refreshHref} className="rounded text-sm font-medium text-kh-link underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-focus">
              Refresh preview
            </Link>
          ) : null}
          {allowed ? <button
            type="button"
            disabled={disabled || state.kind === "APPLYING"}
            onClick={() => void apply()}
            className="rounded-md bg-kh-primary hover:bg-kh-primary-hover px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-focus focus-visible:ring-offset-2"
          >
            {state.kind === "APPLYING" ? "Applying…" : "Apply changes"}
          </button> : <p role="status" className="text-sm text-kh-text-muted">This preview is read-only. Applying is unavailable.</p>}
        </div>
      </div>
      {effectiveState === "STALE" || expired ? (
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
