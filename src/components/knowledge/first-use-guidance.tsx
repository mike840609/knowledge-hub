"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/shell/use-hydrated";
import type { OnboardingPreference } from "@/modules/personal/domain/onboarding";
export type OnboardingState = { value: OnboardingPreference; version: number };
export function FirstUseGuidance({ workspaceId, initial, firstDocumentHref }: { workspaceId: string; initial: OnboardingState; firstDocumentHref?: string }) {
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
  return <section aria-label="Get started" className="border-b border-kh-border px-3 pb-4">
    <div className="flex items-center justify-between gap-3"><h2 className="text-body font-medium text-kh-text">Get started with your folder</h2><Button variant="ghost" size="sm" disabled={!hydrated || saving} onClick={dismiss}>{saving ? "Saving…" : "Hide guidance"}</Button></div>
    <p className="mt-1 text-body text-kh-text-muted">Your local folder is the source of truth. Edit files there, then sync the folder here. Changes arrive only after you review the Preview and apply it.</p>
    <ol className="mt-3 space-y-2 text-body text-kh-text">
      <li>{firstDocumentHref ? <Link className="kh-focus-ring rounded-md text-kh-link" href={firstDocumentHref}>Read your first document</Link> : <Link className="kh-focus-ring rounded-md text-kh-link" href={`/w/${workspaceId}/knowledge`}>Browse your imported folder</Link>}<span className="text-kh-text-muted"> — check its content and source path.</span></li>
      <li><Link className="kh-focus-ring rounded-md text-kh-link" href={`/w/${workspaceId}/search?scope=workspace`}>Search My Space</Link><span className="text-kh-text-muted"> — find a phrase from your folder.</span></li>
      <li><Link className="kh-focus-ring rounded-md text-kh-link" href={`/w/${workspaceId}/agent-context`}>Prepare AI context</Link><span className="text-kh-text-muted"> — select documents, review the context, then copy it for your agent.</span></li>
    </ol>
    {error ? <p role="alert" className="mt-2 text-body text-kh-danger">{error}</p> : null}
  </section>;
}
