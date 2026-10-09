"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { revisionDiff, revisionDiffContext } from "@/lib/revision-diff";
import { Timestamp } from "@/components/ui/timestamp";
import { Button } from "@/components/ui/button";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { governanceRequest, governanceFailure, GovernanceError, type GovernanceFailure } from "@/components/workspaces/governance-error";
import { refreshOnArrival } from "@/components/shell/refresh-on-arrival";
import { useHydrated } from "@/components/shell/use-hydrated";
type Revision = { id: string; revisionNo: number; title: string; markdown: string; createdAt?: Date | string };
export function RevisionRestore({ documentId, href, historical, current, editable }: { documentId: string; href: string; historical: Revision; current: Revision; editable: boolean }) {
  const router = useRouter(); const hydrated = useHydrated(); const { confirmed, access } = useWorkspaceAuthorization();
  const [visible, setVisible] = useState(100);
  const diff = useMemo(() => revisionDiff(historical.markdown, current.markdown), [historical.markdown, current.markdown]);
  const changes = useMemo(() => revisionDiffContext(diff), [diff]);
  const added = diff.filter(line => line.kind === "added").length;
  const removed = diff.filter(line => line.kind === "removed").length;
  const [busy, setBusy] = useState(false); const [error, setError] = useState<GovernanceFailure | null>(null);
  async function restore() {
    setBusy(true); setError(null);
    try {
      await governanceRequest(`/api/documents/${documentId}/restore-revision`, "POST", { revisionNo: historical.revisionNo, expectedCurrentRevisionId: current.id });
      refreshOnArrival(href); router.push(href);
    } catch (e) { setError(governanceFailure(e)); setBusy(false); }
  }
  return <section className="mb-4 space-y-3 border-b border-kh-border pb-4">
    <details><summary className="kh-focus-ring rounded-md text-body text-kh-link">Compare revision {historical.revisionNo} with current revision {current.revisionNo}</summary>
      <div className="mt-3 space-y-3">
        <p className="text-caption text-kh-text-muted">{added} lines added · {removed} lines removed</p>
        <p className="text-caption text-kh-text-muted">Revision {historical.revisionNo}{historical.createdAt ? <> · <Timestamp value={historical.createdAt} /></> : null} → Revision {current.revisionNo}{current.createdAt ? <> · <Timestamp value={current.createdAt} /></> : null}</p>
        {historical.title !== current.title ? <p className="text-body">Title: {historical.title} → {current.title}</p> : null}
        {changes.length ? <div className="max-h-96 overflow-auto rounded-md border border-kh-border">
          <table className="w-full text-body-sm"><caption className="sr-only">Changed lines from revision {historical.revisionNo} to {current.revisionNo}</caption>
            <thead><tr className="text-caption text-kh-text-muted"><th className="px-2 py-1">Old</th><th className="px-2 py-1">New</th><th className="px-2 py-1 text-left">Content</th></tr></thead>
            <tbody>{changes.slice(0, visible).map((line, index) => line ? <tr key={index} className={line.kind === "added" ? "bg-kh-success-bg" : line.kind === "removed" ? "bg-kh-danger-bg" : ""}>
              <td className="select-none px-2 text-caption text-kh-text-muted">{line.before}</td><td className="select-none px-2 text-caption text-kh-text-muted">{line.after}</td>
              <td className="whitespace-pre-wrap break-words px-2 font-mono"><span aria-label={line.kind === "added" ? "Added" : line.kind === "removed" ? "Removed" : "Unchanged"}>{line.kind === "added" ? "+ " : line.kind === "removed" ? "− " : "  "}</span>{line.text || " "}</td>
            </tr> : <tr key={index}><td colSpan={3} className="px-2 py-1 text-caption text-kh-text-muted">Unchanged lines omitted</td></tr>)}</tbody>
          </table>
        </div> : <p className="text-body text-kh-text-muted">No content changes.</p>}
        {visible < changes.length ? <Button type="button" variant="secondary" onClick={() => setVisible(count => count + 100)}>Show more changed lines</Button> : null}
        <details><summary className="cursor-pointer rounded-md text-body kh-focus-ring">View full Markdown</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">{[historical, current].map(r => <section key={r.id}><h3 className="text-body font-medium">Revision {r.revisionNo} · {r.title}</h3><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words bg-kh-bg-subtle p-3 text-body-sm">{r.markdown}</pre></section>)}</div>
        </details>
      </div>
    </details>
    {editable && access.actions.canWrite && <><p className="text-caption text-kh-text-muted">Restoring saves this content as a new version. Existing history is preserved.</p><Button variant="secondary" disabled={!hydrated || !confirmed || busy} onClick={() => void restore()}>{busy ? "Restoring…" : `Restore revision ${historical.revisionNo}`}</Button></>}
    <GovernanceError error={error} />
  </section>;
}
