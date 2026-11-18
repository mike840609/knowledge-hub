"use client";
import {useState} from "react";
import { SelectMenu } from "@/components/ui/select-menu";
import {FRESHNESS_THRESHOLDS, type FreshnessThreshold} from "@/modules/personal/application/knowledge-freshness";
import type {SourceListItemModel} from "@/server/source-read";
import { Label } from "@/components/ui/label";

/**
 * The threshold is the only thing this panel owns now. A folder's freshness is
 * shown on its row in the source list, so the same folder is not listed twice
 * with two vocabularies and two actions.
 */
export function FreshnessReminders({workspaceId,items,preference}: {workspaceId:string;items:SourceListItemModel[];preference:{thresholdDays:FreshnessThreshold;version:number}}) {
  const [setting,setSetting]=useState(preference);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
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
    <details>
      <summary className="kh-focus-ring inline-flex min-h-6 w-fit cursor-pointer items-center rounded-md text-caption text-kh-text-muted">Freshness reminder settings</summary>
      <div className="mt-2 space-y-2">
        <Label inline className="flex-wrap">Review folders after<SelectMenu aria-label="Freshness threshold" value={setting.thresholdDays} disabled={saving} onValueChange={days=>void save(days)} options={FRESHNESS_THRESHOLDS.map(days=>({value:days,label:days === 7 ? "1 week" : days === 14 ? "2 weeks" : "1 month"}))} /></Label>
        <p className="text-caption text-kh-text-muted">Folders older than this are marked “Stale” in the list above. Age reflects the last applied import; external folders are not checked automatically.</p>
      </div>
    </details>
    {error?<p role="alert" className="text-body-sm text-kh-text">{error}</p>:null}
    {saving?<p role="status" className="text-caption text-kh-text-muted">Saving reminder preference…</p>:null}
  </section>;
}
