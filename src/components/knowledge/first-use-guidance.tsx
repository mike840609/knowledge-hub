"use client";
import type { OnboardingProgress } from "@/server/onboarding-progress";
import { GuidanceVisibilityContext } from "./guidance-visibility";
import { useContext, useState } from "react";
import Link from "next/link";
import { Illustration } from "./illustration";
import { Circle, CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/shell/use-hydrated";
import type { OnboardingPreference } from "@/modules/personal/domain/onboarding";
const example = (kind: "start" | "reading" | "search" | "context") => <div className="flex min-h-32 items-center justify-center rounded-md bg-kh-bg-subtle p-3"><Illustration kind={kind} /></div>;
export type OnboardingState = { value: OnboardingPreference; version: number };
export function FirstUseGuidance({ workspaceId, initial, firstDocumentHref, imported, progress }: { workspaceId: string; initial: OnboardingState; firstDocumentHref?: string; imported: boolean; progress: OnboardingProgress }) {
  const visibility = useContext(GuidanceVisibilityContext);
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
      const saved = await response.json();
      setState(saved);
      visibility.setDismissed(saved.value.dismissed);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to hide guidance."); }
    finally { setSaving(false); }
  }
  const hasContent = imported || Boolean(firstDocumentHref);
  const count = Number(hasContent) + Number(progress.read) + Number(progress.search) + Number(progress.context);
  const status = (complete: boolean) => <span className="mr-2 inline-flex align-[-2px] text-kh-text-muted">{complete ? <CircleCheck size={14} aria-hidden="true" className="text-kh-success" /> : <Circle size={14} aria-hidden="true" />}<span className="sr-only">{complete ? "Completed: " : "To do: "}</span></span>;
  return <section aria-label="Get started" className="border-b border-kh-border px-3 pb-4">
    <div className="flex items-center justify-between gap-3"><h2 className="text-body font-medium text-kh-text">{count === 4 ? "Your workspace is ready" : hasContent ? (imported ? "Get started with your folder" : "Get started with your documents") : "Start your knowledge workspace"}</h2><Button variant="ghost" size="sm" disabled={!hydrated || saving} onClick={dismiss}>{saving ? "Saving…" : "Hide guidance"}</Button></div>
    {/* Only an importer needs the one idea the drawings cannot show: the folder, not the Hub, is where its files change. */}
    {imported ? <p className="mt-1 text-body text-kh-text-muted">Your local folder is the source of truth: edit files there, then import again.</p> : null}
    <p className="mt-1 text-caption text-kh-text-muted">{count} of 4 steps complete</p>
    <ol className="mt-4 grid gap-3 text-body text-kh-text sm:grid-cols-2">
      {/* Either way in counts: a note-first reader has added a document as surely as an importer has. */}
      <li className="min-w-0 rounded-md border border-kh-border bg-kh-bg p-4">{example("start")}<div className="mt-4 font-medium">{status(hasContent)}{hasContent ? <span>Add your first document</span> : <Link className="kh-focus-ring rounded-md text-kh-link" href={`/w/${workspaceId}/knowledge`}>Add your first document</Link>}</div><p className="mt-2 text-body-sm text-kh-text-muted">Import a folder, or write one here.</p></li>
      <li className="min-w-0 rounded-md border border-kh-border bg-kh-bg p-4">{example("reading")}<div className="mt-4 font-medium">{status(progress.read)}{!hasContent ? <span className="text-kh-text-muted">Read your first document</span> : firstDocumentHref ? <Link className="kh-focus-ring rounded-md text-kh-link" href={firstDocumentHref}>Read your first document</Link> : <Link className="kh-focus-ring rounded-md text-kh-link" href={`/w/${workspaceId}/knowledge`}>Browse your imported folder</Link>}</div><p className="mt-2 text-body-sm text-kh-text-muted">Open one and see where it came from.</p></li>
      <li className="min-w-0 rounded-md border border-kh-border bg-kh-bg p-4">{example("search")}<div className="mt-4 font-medium">{status(progress.search)}{!hasContent ? <span className="text-kh-text-muted">Search My Space</span> : <Link className="kh-focus-ring rounded-md text-kh-link" href={`/w/${workspaceId}/search?scope=workspace`}>Search My Space</Link>}</div><p className="mt-2 text-body-sm text-kh-text-muted">Find a phrase and open the match.</p></li>
      <li className="min-w-0 rounded-md border border-kh-border bg-kh-bg p-4">{example("context")}<div className="mt-4 font-medium">{status(progress.context)}{!hasContent ? <span className="text-kh-text-muted">Prepare AI context</span> : <Link className="kh-focus-ring rounded-md text-kh-link" href={`/w/${workspaceId}/agent-context`}>Prepare AI context</Link>}</div><p className="mt-2 text-body-sm text-kh-text-muted">Turn chosen documents into Markdown for your agent.</p></li>
    </ol>
    {error ? <p role="alert" className="mt-2 text-body text-kh-danger">{error}</p> : null}
  </section>;
}
