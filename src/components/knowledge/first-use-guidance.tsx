"use client";
import type { OnboardingProgress } from "@/server/onboarding-progress";
import { WorkspaceImportLink } from "@/components/shell/workspace-import-link";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/shell/use-hydrated";
import type { OnboardingPreference } from "@/modules/personal/domain/onboarding";
export type OnboardingState = { value: OnboardingPreference; version: number };
export function FirstUseGuidance({ workspaceId, initial, firstDocumentHref, imported, progress }: { workspaceId: string; initial: OnboardingState; firstDocumentHref?: string; imported: boolean; progress: OnboardingProgress }) {
  const [state, setState] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const hydrated = useHydrated();
  if (state.value.dismissed) return null;
  async function dismiss() {
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/onboarding`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: { schemaVersion: 1, dismissed: true }, version: state.version }) });
      if (!response.ok) throw new Error("Unable to hide guidance. Reload and try again.");
      setState(await response.json());
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to hide guidance."); }
    finally { setSaving(false); }
  }
  const hasContent = imported || Boolean(firstDocumentHref);
  const count = Number(imported) + Number(progress.read) + Number(progress.search) + Number(progress.context);
  const status = (complete: boolean) => <span className="mr-2 text-caption text-kh-text-muted">{complete ? "✓ Completed" : "○ To do"}</span>;
  return <section aria-label="Get started" className="border-b border-kh-border px-3 pb-4">
    <div className="flex items-center justify-between gap-3"><h2 className="text-body font-medium text-kh-text">{count === 4 ? "Your workspace is ready" : hasContent ? (imported ? "Get started with your folder" : "Get started with your documents") : "Turn your folder into a knowledge workspace"}</h2><Button variant="ghost" size="sm" disabled={!hydrated || saving} onClick={dismiss}>{saving ? "Saving…" : "Hide guidance"}</Button></div>
    <p className="mt-1 text-body text-kh-text-muted">{imported ? "Your local folder is the source of truth. Edit files there, then sync the folder here. Changes arrive only after you review the Preview and apply it." : hasContent ? "Your saved notes are ready to read, search, and use as AI context. You can also import a Markdown folder." : "Import Markdown files to browse, search, and prepare context for your AI agent. Choose a folder, review the Preview, then apply it. Your original files stay in your local folder."}</p>
    <p className="mt-3 text-caption text-kh-text-muted">{count} of 4 steps complete{count === 4 ? " — you can hide this guide whenever you are ready." : " — progress is saved after successful actions."}</p>
    <ol className="mt-3 space-y-2 text-body text-kh-text">
      <li>{status(imported)}{imported ? <span>Import your first folder</span> : <WorkspaceImportLink className="kh-focus-ring rounded-md text-kh-link" href={`/w/${workspaceId}/sources/import`}>Import your first folder</WorkspaceImportLink>}</li>
      <li>{status(progress.read)}{!hasContent ? <span className="text-kh-text-muted">Read your first document</span> : firstDocumentHref ? <Link className="kh-focus-ring rounded-md text-kh-link" href={firstDocumentHref}>Read your first document</Link> : <Link className="kh-focus-ring rounded-md text-kh-link" href={`/w/${workspaceId}/knowledge`}>Browse your imported folder</Link>}<span className="text-kh-text-muted"> — check its content and source path.</span></li>
      <li>{status(progress.search)}{!hasContent ? <span className="text-kh-text-muted">Search My Space</span> : <Link className="kh-focus-ring rounded-md text-kh-link" href={`/w/${workspaceId}/search?scope=workspace`}>Search My Space</Link>}<span className="text-kh-text-muted"> — find a phrase from your folder.</span></li>
      <li>{status(progress.context)}{!hasContent ? <span className="text-kh-text-muted">Prepare AI context</span> : <Link className="kh-focus-ring rounded-md text-kh-link" href={`/w/${workspaceId}/agent-context`}>Prepare AI context</Link>}<span className="text-kh-text-muted"> — select documents and generate a context preview for your agent.</span></li>
    </ol>
    {error ? <p role="alert" className="mt-2 text-body text-kh-danger">{error}</p> : null}
  </section>;
}
