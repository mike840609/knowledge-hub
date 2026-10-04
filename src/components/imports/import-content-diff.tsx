"use client";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { revisionDiff, revisionDiffContext } from "@/lib/revision-diff";
type Diff = { before: { title: string; markdown: string }; after: { title: string; markdown: string } };
export function ImportContentDiff({ snapshotId, sourcePath }: { snapshotId: string; sourcePath: string }) {
  const [diff,setDiff]=useState<Diff|null>(null);
  const [open,setOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const [visible,setVisible]=useState(100);
  const [error,setError]=useState<string|null>(null);
  async function toggle() {
    if(diff){setOpen(!open);return;}
    setBusy(true);setError(null);
    try {
      const response=await fetch(`/api/source-imports/${snapshotId}/content-diff?path=${encodeURIComponent(sourcePath)}`,{cache:"no-store"});
      const body=await response.json();
      if(!response.ok) throw new Error(body.error?.message ?? "Could not load changes. Try again.");
      setDiff(body);setOpen(true);
    } catch(e){setError(e instanceof Error ? e.message : "Could not load changes. Try again.");}
    finally{setBusy(false);}
  }
  const lines=useMemo(()=>diff?revisionDiffContext(revisionDiff(diff.before.markdown,diff.after.markdown)):[],[diff]);
  return <div className="mt-2 space-y-2">
    <Button type="button" variant="secondary" disabled={busy} aria-expanded={open} onClick={()=>void toggle()}>{busy?"Loading changes…":open?"Hide content changes":"View content changes"}</Button>
    {error?<p role="alert" className="text-caption text-kh-danger">{error}</p>:null}
    {diff&&open?<div className="max-h-96 overflow-auto rounded-md border border-kh-border">
      {diff.before.title!==diff.after.title?<p className="px-3 py-2 text-caption">Title: {diff.before.title} → {diff.after.title}</p>:null}
      {lines.length?<table aria-label={`Content changes: ${sourcePath}`} className="w-full text-caption"><thead><tr className="bg-kh-bg-subtle"><th className="px-2 py-1 text-left">Before</th><th className="px-2 py-1 text-left">After</th><th className="px-2 py-1 text-left">Change</th><th className="px-2 py-1 text-left">Markdown</th></tr></thead><tbody>{lines.slice(0,visible).map((line,i)=><tr key={i} className={line?.kind==="removed"?"text-kh-danger":line?.kind==="added"?"text-kh-success":"text-kh-text-muted"}><td className="px-2 py-1">{line?.before}</td><td className="px-2 py-1">{line?.after}</td><td className="px-2 py-1">{line?.kind==="added"?"Added":line?.kind==="removed"?"Removed":""}</td><td className="whitespace-pre-wrap break-all px-2 py-1 font-mono">{line?.text??"…"}</td></tr>)}</tbody></table>:<p className="px-3 py-2 text-caption text-kh-text-muted">Markdown unchanged; title or metadata changed.</p>}
      {visible < lines.length ? <Button type="button" variant="secondary" onClick={()=>setVisible(count=>count+100)}>Show more changed lines</Button> : null}
    </div>:null}
  </div>;
}
