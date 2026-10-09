"use client";
import {useState} from "react";
import Link from "next/link";
import {Select} from "@/components/ui/select";
import {Timestamp} from "@/components/ui/timestamp";
import {FRESHNESS_THRESHOLDS, knowledgeFreshness, type FreshnessThreshold} from "@/modules/personal/application/knowledge-freshness";
import type {SourceListItemModel} from "@/server/source-read";

export function FreshnessReminders({workspaceId,items,preference,now}: {workspaceId:string;items:SourceListItemModel[];preference:{thresholdDays:FreshnessThreshold;version:number};now:string}) {
  const [setting,setSetting]=useState(preference);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  const reminders=knowledgeFreshness(items,setting.thresholdDays,new Date(now));
  async function save(thresholdDays:FreshnessThreshold) {
    setSaving(true);setError("");
    try {
      const response=await fetch(`/api/workspaces/${workspaceId}/personal/freshness`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({value:{thresholdDays},version:setting.version})});
      const body=await response.json();
      if (!response.ok) throw new Error(body.error?.message??body.message??"Could not save. Reload and try again.");
      setSetting({thresholdDays,version:body.version});
    } catch (error) {setError(error instanceof Error?error.message:"Could not save. Reload and try again.");}
    finally {setSaving(false);}
  }
  if (!items.some(item => item.source.sourceType === "FOLDER_SYNC" && item.source.status === "ACTIVE")) return null;
  return <section aria-label="Knowledge freshness" className="px-3 space-y-2">
    {reminders.length > 0 ? <h2 className="text-caption font-medium text-kh-text-muted">Folders to review</h2> : null}
    <details>
      <summary className="kh-focus-ring w-fit cursor-pointer rounded-md text-caption text-kh-text-muted">Freshness reminder settings</summary>
      <div className="mt-2 space-y-2">
        <label className="flex flex-wrap items-center gap-2 text-caption text-kh-text-muted">Review folders after<Select aria-label="Freshness threshold" value={setting.thresholdDays} disabled={saving} onChange={e=>void save(Number(e.target.value) as FreshnessThreshold)}>{FRESHNESS_THRESHOLDS.map(days=><option key={days} value={days}>{days === 7 ? "1 week" : days === 14 ? "2 weeks" : "1 month"}</option>)}</Select></label>
        <p className="text-caption text-kh-text-muted">Age reflects the last applied import. External folders are not checked automatically.</p>
      </div>
    </details>
    {error?<p role="alert" className="text-body-sm text-kh-text">{error}</p>:null}
    {saving?<p role="status" className="text-caption text-kh-text-muted">Saving reminder preference…</p>:null}
    {reminders.length?<ul className="space-y-0.5">{reminders.map(item=><li key={item.sourceId} className="kh-interactive-row flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-3 py-2">
      <Link className="kh-focus-ring min-w-0 basis-full break-words rounded-md text-body font-medium sm:basis-auto sm:flex-1 text-kh-text" href={`/w/${workspaceId}/sources/${item.sourceId}`}>{item.sourceName}</Link>
      <span className="text-caption text-kh-text-muted">{item.status==="pending"?"Awaiting Apply":item.status==="failed"?"Latest sync failed":item.status==="never"?"Never imported":"Check for folder updates"}{item.lastImportedAt?<> · Last imported <Timestamp value={item.lastImportedAt} variant="relative"/></>:null}</span>
      <Link className="kh-focus-ring rounded-md text-body-sm text-kh-link" href={item.previewId?`/w/${workspaceId}/sources/imports/${item.previewId}`:`/w/${workspaceId}/sources/${item.sourceId}/update`}>{item.status==="pending"?"Review preview":item.status==="failed"?"Retry import":"Update from folder"}</Link>
    </li>)}</ul>:null}
  </section>;
}
