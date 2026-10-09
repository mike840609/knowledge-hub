"use client";

import {Input} from "@/components/ui/input";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { requestWorkspaceAccessCheck, useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { useEffect, useState } from "react";
import type { ImportPreview } from "@/modules/sources/application/reconcile-import-snapshot";
import { adoptPendingHandle } from "@/components/imports/folder-handle-store";
import { buttonClasses } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export type ApplyFailure = { code: string; message: string; latchStale: boolean };

const STALE_GUIDANCE = "The source was updated by another sync. Check for changes again to create a fresh preview.";
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
const FINAL_MINUTES_MS = 5 * 60 * 1000;

/**
 * A preview lasts 30 minutes, and an expired one means scanning and uploading the
 * folder again, so the time left is shown while it can still be applied.
 */
export function previewTimeLeft(msLeft: number): string {
  if (msLeft < 60_000) return "This preview expires in less than a minute. Apply it now, or check for changes again later.";
  const minutes = Math.floor(msLeft / 60_000);
  return `This preview expires in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}

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
  const [sourceConfirmation,setSourceConfirmation]=useState("");
  const riskConfirmed=!preview.safety?.highRisk || (!!preview.planHash && sourceConfirmation===preview.sourceName);
  const [versionConflict, setVersionConflict] = useState(false);
  const [expired, setExpired] = useState(preview.expired);
  // Read after mount (the server's clock is not the reader's) and refreshed twice a minute.
  const [msLeft, setMsLeft] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setMsLeft(new Date(preview.expiresAt).getTime() - Date.now());
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, [preview.expiresAt]);
  useEffect(() => {
    const remaining = new Date(preview.expiresAt).getTime() - Date.now();
    setExpired(preview.expired || remaining <= 0);
    const timer = setTimeout(() => setExpired(true), Math.max(0, Math.min(remaining, 2_147_483_647)));
    return () => clearTimeout(timer);
  }, [preview.expired, preview.expiresAt]);
  const effectiveState = versionConflict ? "STALE" : preview.state;
  const stale = effectiveState === "STALE" || effectiveState === "APPLIED" || expired;
  const disabled = !riskConfirmed || !allowed || preview.hasBlockers || stale || effectiveState !== "READY";
  const cancelHref = preview.sourceId
    ? `/w/${workspaceId}/sources/${preview.sourceId}`
    : `/w/${workspaceId}/sources`;
  const refreshHref = preview.sourceId
    ? `/w/${workspaceId}/sources/${preview.sourceId}/update`
    : `/w/${workspaceId}/sources/import`;

  async function openResult(body:{sourceId:string;runId?:string|null}):Promise<void>{
    try{await adoptPendingHandle(preview.snapshotId,body.sourceId);}catch{}
    router.push(body.runId?`/w/${workspaceId}/sources/${body.sourceId}/runs/${body.runId}`:`/w/${workspaceId}/sources/${body.sourceId}?import=success`);
  }
  async function recover():Promise<boolean>{
    try{
      const status=await fetch(`/api/source-imports/${preview.snapshotId}`,{cache:"no-store"});
      if(!status.ok)return false;
      const current=await status.json();
      if(current.state!=="APPLIED")return false;
      const response=await fetch(`/api/source-imports/${preview.snapshotId}/apply`,{method:"POST"});
      const body=await response.json();
      if(!response.ok||typeof body.sourceId!=="string")return false;
      await openResult(body);return true;
    }catch{return false;}
  }
  async function apply(): Promise<void> {
    if (disabled || state.kind === "APPLYING" || new Date(preview.expiresAt).getTime() <= Date.now()) return;
    setState({ kind: "APPLYING" });
    try {
      const request:RequestInit=preview.safety?.highRisk?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({riskAcknowledgment:{planHash:preview.planHash,sourceName:sourceConfirmation}})}:{method:"POST"};
      const response = await fetch(`/api/source-imports/${preview.snapshotId}/apply`, request);
      const body = await response.json().catch(() => null);
      if (!response.ok || !body || typeof body !== "object" || !("sourceId" in body)) {
        // A known snapshot's 404 is an import-session problem, not evidence
        // that Workspace authorization changed. Known-snapshot revocation is
        // translated by the server to 403 ACCESS_DENIED.
        if (response.status !== 404) {
          requestWorkspaceAccessCheck(response.status, readEnvelope(body)?.code);
        }
        if((response.status>=500||response.ok)&&await recover())return;
        const failure = classifyApplyError(response.status, body);
        if (failure.latchStale) setVersionConflict(true);
        setState({ kind: "ERROR", code: failure.code, message: failure.message });
        return;
      }
      await openResult(body as {sourceId:string;runId?:string|null});
    } catch {
      if(await recover())return;
      setState({ kind: "ERROR", code: "IMPORT_APPLY_FAILED", message: "The Apply result could not be confirmed. Retry safely to recover the same sync result." });
    }
  }

  return (
    <div className="sticky bottom-0 -mx-6 border-t border-kh-border bg-kh-bg px-6 py-3">
      {preview.safety?.highRisk && allowed ? <Label className="mx-auto mb-3 max-w-page">Type <strong>{preview.sourceName}</strong> to confirm this folder scope
        <Input aria-label="Confirm source name" value={sourceConfirmation} onChange={e=>setSourceConfirmation(e.target.value)} autoComplete="off" className="ml-2 rounded-md border border-kh-border bg-kh-bg px-2 py-1 text-kh-text kh-focus-ring" />
      </Label> : null}
      <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-3">
        <Link
          href={cancelHref}
          className={buttonClasses({ variant: "secondary", size: "lg" })}
        >
          Cancel
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          {stale && allowed ? (
            <Link href={refreshHref} className="rounded-md text-body font-medium text-kh-link underline-offset-2 hover:underline kh-focus-ring">
              Refresh preview
            </Link>
          ) : null}
          {allowed ? <button
            type="button"
            disabled={disabled || state.kind === "APPLYING"}
            onClick={() => void apply()}
            className={buttonClasses({ size: "lg" })}
          >
            {state.kind === "APPLYING" ? "Applying…" : "Apply changes"}
          </button> : <p role="status" className="text-body text-kh-text-muted">This preview is read-only. Applying is unavailable.</p>}
        </div>
      </div>
      {msLeft !== null && !expired && effectiveState === "READY" ? (
        <p className={`mx-auto mt-2 max-w-page text-caption ${msLeft <= FINAL_MINUTES_MS ? "text-kh-warning" : "text-kh-text-muted"}`}>
          {previewTimeLeft(msLeft)}
        </p>
      ) : null}
      {effectiveState === "STALE" || expired ? (
        <p className="mx-auto mt-2 max-w-page text-body text-kh-danger">
          {expired ? "This preview expired. Check for changes again to create a fresh preview." : "The source was updated by another sync. Check for changes again to create a fresh preview."}
        </p>
      ) : null}
      {effectiveState === "APPLIED" ? (
        <p className="mx-auto mt-2 max-w-page text-body text-kh-text-muted">This preview was already applied.</p>
      ) : null}
      {state.kind === "ERROR" ? (
        <p role="alert" className="mx-auto mt-2 max-w-page text-body text-kh-danger">
          {state.message}
        </p>
      ) : null}
      {state.kind === "ERROR" || effectiveState === "STALE" || expired ? <p className="mx-auto mt-2 max-w-page text-body"><Link href={`/w/${workspaceId}/help#troubleshooting`} className="kh-focus-ring rounded-md text-kh-link hover:underline">Sync troubleshooting</Link></p> : null}
      {state.kind === "ERROR" ? <details className="mx-auto mt-2 max-w-page text-caption text-kh-text-muted"><summary className="cursor-pointer rounded-md kh-focus-ring">Technical details</summary><code>{state.code}</code></details> : null}
    </div>
  );
}
