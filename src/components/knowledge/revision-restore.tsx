"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { governanceRequest, governanceFailure, GovernanceError, type GovernanceFailure } from "@/components/workspaces/governance-error";
import { refreshOnArrival } from "@/components/shell/refresh-on-arrival";
import { useHydrated } from "@/components/shell/use-hydrated";
type Revision = { id: string; revisionNo: number; title: string; markdown: string };
export function RevisionRestore({ documentId, href, historical, current, editable }: { documentId: string; href: string; historical: Revision; current: Revision; editable: boolean }) {
  const router = useRouter(); const hydrated = useHydrated(); const { confirmed, access } = useWorkspaceAuthorization();
  const [busy, setBusy] = useState(false); const [error, setError] = useState<GovernanceFailure | null>(null);
  async function restore() {
    setBusy(true); setError(null);
    try {
      await governanceRequest(`/api/documents/${documentId}/restore-revision`, "POST", { revisionNo: historical.revisionNo, expectedCurrentRevisionId: current.id });
      refreshOnArrival(href); router.push(href);
    } catch (e) { setError(governanceFailure(e)); setBusy(false); }
  }
  return <section className="mb-4 space-y-3 border-b border-kh-border pb-4">
    <details><summary className="kh-focus-ring cursor-pointer text-body text-kh-link">Compare revision {historical.revisionNo} with current revision {current.revisionNo}</summary>
      <div className="mt-3 grid gap-3 md:grid-cols-2">{[historical, current].map(r => <section key={r.id}><h3 className="text-body font-medium">Revision {r.revisionNo} · {r.title}</h3><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words bg-kh-bg-subtle p-3 text-body-sm">{r.markdown}</pre></section>)}</div>
    </details>
    {editable && access.actions.canWrite && <><p className="text-caption text-kh-text-muted">Restoring saves this content as a new version. Existing history is preserved.</p><Button variant="secondary" disabled={!hydrated || !confirmed || busy} onClick={() => void restore()}>{busy ? "Restoring…" : `Restore revision ${historical.revisionNo}`}</Button></>}
    <GovernanceError error={error} />
  </section>;
}
