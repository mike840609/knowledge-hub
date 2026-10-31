"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, Search } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { Timestamp } from "@/components/ui/timestamp";
import { EmptyState } from "@/components/ui/empty-state";
import { Illustration } from "@/components/knowledge/illustration";
import { applyAndSearch, LiveSearch } from "@/components/search/live-search-submit";
import { navigateListRows } from "@/lib/list-row-navigation";
import type { SavedShareList } from "@/modules/knowledge/domain/saved-share";
export function SavedSharesView({ workspaceId,model,filterError }: { workspaceId:string;model:SavedShareList;filterError?:string }) {
  const router=useRouter(),pending=useRef(false);
  const [status,setStatus]=useState<string>(model.query.status);
  const filterForm=useRef<HTMLFormElement>(null);
  useEffect(()=>setStatus(model.query.status),[model.query.status]);
  const [busy,setBusy]=useState<string|null>(null),[error,setError]=useState(""),[removed,setRemoved]=useState(new Set<string>());
  // Optimistic removals belong to this server snapshot; a refresh may contain a re-saved link.
  useEffect(()=>setRemoved(new Set()),[model.items]);
  const items=model.items.filter(item=>!removed.has(item.id));
  const filtered=!!model.query.q||model.query.status!=="all"||model.query.page>1;
  const base=`/w/${workspaceId}/shares`,clear=`${base}?tab=saved`;
  const href=(page:number)=>`${base}?${new URLSearchParams({tab:"saved",q:model.query.q,status:model.query.status,page:String(page)})}`;
  async function remove(id:string){
    if(pending.current)return;
    pending.current=true;setBusy(id);setError("");
    try{const response=await fetch(`/api/saved-shares/${id}`,{method:"DELETE"});if(!response.ok)throw new Error();setRemoved(current=>new Set([...current,id]));router.refresh();}
    catch{setError("Could not remove this saved share. Try again.");}
    finally{pending.current=false;setBusy(null);}
  }
  return <>
    <form ref={filterForm} action={base} method="get" aria-label="Filter saved shares" className="mt-4 flex flex-wrap items-center gap-2">
      <Input type="hidden" name="tab" value="saved"/>
      <div className="relative min-w-0 basis-full sm:flex-1 sm:basis-auto"><label className="sr-only" htmlFor="saved-shares-query">Find saved shares</label><Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-kh-text-muted"/><Input id="saved-shares-query" name="q" defaultValue={model.query.q} placeholder="Find title or sharing person…" maxLength={200} className="kh-search-field"/></div>
      <label className="sr-only" htmlFor="saved-shares-status">Saved share status</label><SelectMenu id="saved-shares-status" name="status" value={status} onValueChange={(value)=>applyAndSearch(filterForm.current,()=>setStatus(value))} options={[{value:"all",label:"All statuses"},{value:"available",label:"Available"},{value:"unavailable",label:"Unavailable"}]}/>
      <LiveSearch/>
      {filtered&&<Link className="kh-focus-ring rounded-md text-body-sm text-kh-link" href={clear}>Clear filters</Link>}
    </form>
    {(error||filterError)&&<p role="alert" className="mt-3 text-body-sm text-kh-danger">{filterError||error}</p>}
    {!filterError&&items.length===0&&<EmptyState icon={Bookmark} illustration={!filtered?<Illustration kind="shares"/>:undefined} title={filtered?"No saved shares match these filters.":"No saved shares yet."} description={filtered?"Clear the filters to see your other saved shares.":"Open an article shared with you and choose Save while signed in. Find it here on any device; the sender can still revoke access."} action={filtered?<Link className={buttonClasses({variant:"secondary"})} href={clear}>Clear filters</Link>:undefined}/>}
    {items.length>0&&<div aria-hidden="true" className="mt-4 hidden grid-cols-[minmax(0,1fr)_7rem_7rem_5rem] gap-3 border-b border-kh-border px-3 py-2 text-caption text-kh-text-muted md:grid"><span>Article / shared by</span><span>Saved</span><span>Expires</span><span/></div>}
    <ul aria-label="Saved shares" onKeyDown={navigateListRows} className="mt-4 space-y-2 md:mt-0 md:space-y-0">{items.map(item=><li key={item.id} className="group rounded-md border border-kh-border bg-kh-bg p-3 hover:bg-kh-bg-hover focus-within:bg-kh-bg-hover md:rounded-none md:border-x-0 md:border-t-0 md:py-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 md:grid-cols-[minmax(0,1fr)_7rem_7rem_5rem]">
        <div className="min-w-0">{item.path?<Link prefetch={false} data-list-row className="kh-focus-ring block truncate rounded-md text-body font-medium text-kh-text hover:text-kh-link" href={item.path}>{item.title}</Link>:<span className="block truncate text-body font-medium text-kh-text">{item.title}</span>}
          <p className="truncate text-caption text-kh-text-muted">Shared by {item.sharedByName}</p>
          <p className="text-caption text-kh-text-muted">{item.status==="available"?<>Available{item.updatedAt&&<> · Updated <Timestamp value={item.updatedAt}/></>}</>:item.status==="expired"?"Expired":"Link unavailable"}</p>
        </div>
        <span className="col-start-1 row-start-2 text-caption text-kh-text-muted md:col-auto md:row-auto"><span className="md:sr-only">Saved </span><Timestamp value={item.savedAt}/></span>
        <span className="col-span-2 text-caption text-kh-text-muted md:col-span-1"><span className="md:sr-only">Expires </span><Timestamp value={item.expiresAt} variant="date"/></span>
        <Button variant="ghost" size="sm" className="col-start-2 row-start-1 justify-self-end md:col-auto md:row-auto" aria-label={`Remove saved share: ${item.title}`} disabled={busy!==null} onClick={()=>void remove(item.id)}>Remove</Button>
      </div>
    </li>)}</ul>
    {(model.query.page>1||model.hasNext)&&<nav aria-label="Saved share pages" className="mt-4 flex gap-4 text-body-sm"><span className="text-kh-text-muted">Page {model.query.page}</span>{model.query.page>1&&<Link className="kh-focus-ring rounded-md text-kh-link" href={href(model.query.page-1)}>Previous</Link>}{model.hasNext&&<Link className="kh-focus-ring rounded-md text-kh-link" href={href(model.query.page+1)}>Next</Link>}</nav>}
  </>;
}
