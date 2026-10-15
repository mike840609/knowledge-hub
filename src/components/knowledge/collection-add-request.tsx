"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { COLLECTION_ADD_REQUEST_EVENT } from "@/components/actions/action-menu";
type Target={documentId:string;sourceId:string};
type Choice={id:string;name:string;version:number};
type CollectionPage={items:Choice[];nextCursor:string|null};

export function CollectionAddDialogHost({workspaceId}:{workspaceId:string}) {
  const router=useRouter();
  const [target,setTarget]=useState<Target|null>(null);
  const [choices,setChoices]=useState<Choice[]>([]);
  const [choice,setChoice]=useState("");
  const [note,setNote]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const pending=useRef(false);
  useEffect(()=>{
    function onRequest(event:Event) {
      const data=(event as CustomEvent<Target>).detail;
      if(!data||typeof data.documentId!=="string"||typeof data.sourceId!=="string")return;
      setTarget(data);setChoice("");setChoices([]);setNote("");setError(null);setNotice(null);
    }
    window.addEventListener(COLLECTION_ADD_REQUEST_EVENT,onRequest);
    return()=>window.removeEventListener(COLLECTION_ADD_REQUEST_EVENT,onRequest);
  },[]);
  useEffect(()=>{
    if(!target)return;
    let cancelled=false;
    async function load(){
      setBusy(true);setError(null);
      try{
        const all:Choice[]=[];
        let cursor:string|null=null;
        for(let page=0;page<20;page++){
          const url=`/api/workspaces/${workspaceId}/collections${cursor?`?cursor=${encodeURIComponent(cursor)}`:""}`;
          const response=await fetch(url,{cache:"no-store"});
          const data=await response.json() as CollectionPage&{error?:{message?:string}};
          if(!response.ok)throw new Error(data.error?.message??"Could not load Collections.");
          all.push(...data.items);cursor=data.nextCursor;
          if(!cursor)break;
        }
        if(!cancelled){setChoices(all);setChoice(all[0]?.id??"");}
      }catch(e){if(!cancelled)setError(e instanceof Error?e.message:"Could not load Collections.");}
      finally{if(!cancelled)setBusy(false);}
    }
    void load();return()=>{cancelled=true;};
  },[target,workspaceId]);
  if(!target)return null;
  const selected=choices.find(item=>item.id===choice);
  async function add(){
    if(pending.current||!selected||!target)return;
    pending.current=true;setBusy(true);setError(null);
    try{
      const result=await fetch(`/api/workspaces/${workspaceId}/collections/${selected.id}/items`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({documentId:target.documentId,readingNote:note,expectedVersion:selected.version}),
      });
      const data=await result.json();
      if(!result.ok){
        if(result.status===409)throw new Error("Collection changed. Close this dialog and retry with its latest version.");
        throw new Error(data.error?.message??"Could not add document.");
      }
      setNotice("Added to Collection.");router.refresh();
      setTarget(null);
    }catch(e){setError(e instanceof Error?e.message:"Could not add document.");}
    finally{pending.current=false;setBusy(false);}
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setTarget(null);}}>
    <section role="dialog" aria-modal="true" aria-labelledby="add-to-collection-title" className="w-full max-w-md rounded-lg border border-kh-border bg-kh-bg p-5 shadow-xl">
      <h2 id="add-to-collection-title" className="text-lg font-semibold text-kh-text">Add to Collection</h2>
      <p className="mt-1 text-body-sm text-kh-text-muted">Add a reference to this document. The original Markdown remains unchanged.</p>
      {error?<p role="alert" className="mt-3 text-body text-kh-danger">{error}</p>:null}
      {notice?<p role="status" className="mt-3 text-body">{notice}</p>:null}
      <label htmlFor="target-collection" className="mt-4 block text-caption font-medium text-kh-text-muted">Collection</label>
      <select id="target-collection" value={choice} disabled={busy||choices.length===0} onChange={e=>setChoice(e.target.value)} className="kh-control mt-1 w-full rounded-md border border-kh-border bg-kh-bg px-2 py-2 text-body">
        {choices.length===0?<option value="">No collections available</option>:choices.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <label htmlFor="collection-reading-note" className="mt-3 block text-caption font-medium text-kh-text-muted">Reading note (optional)</label>
      <textarea id="collection-reading-note" value={note} onChange={e=>setNote(e.target.value)} maxLength={500} rows={2} className="kh-control mt-1 w-full rounded-md border border-kh-border bg-kh-bg p-2 text-body" placeholder="Why should someone read this?"/>
      <div className="mt-4 flex justify-end gap-2">
        <button className="kh-control rounded-md border border-kh-border px-3 py-2 text-body" type="button" onClick={()=>setTarget(null)} disabled={busy}>Cancel</button>
        <button className="kh-control rounded-md bg-kh-primary px-3 py-2 text-body font-medium text-white disabled:opacity-50" type="button" onClick={()=>void add()} disabled={busy||!selected}>{busy?"Working…":"Add document"}</button>
      </div>
    </section>
  </div>;
}
