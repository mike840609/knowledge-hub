"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { CollectionDetail, CollectionItemView } from "@/modules/knowledge/domain/knowledge-collection";

type Candidate={documentId:string;sourceId:string;title:string;sourceName:string};
export function CollectionDetailView({workspaceId,model,canWrite}:{
  workspaceId:string;model:CollectionDetail;canWrite:boolean;
}) {
  const router=useRouter();
  const [version,setVersion]=useState(model.collection.version);
  const [items,setItems]=useState(model.items);
  const [name,setName]=useState(model.collection.name);
  const [description,setDescription]=useState(model.collection.description);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  const [query,setQuery]=useState("");
  const [candidates,setCandidates]=useState<Candidate[]>([]);
  const [searching,setSearching]=useState(false);
  const [notes,setNotes]=useState<Record<string,string>>({});
  const base=`/api/workspaces/${workspaceId}/collections/${model.collection.id}`;
  const isArchived=model.collection.status==="ARCHIVED";
  const editable=canWrite&&!isArchived;
  useEffect(()=>{setVersion(model.collection.version);setItems(model.items);
    setName(model.collection.name);setDescription(model.collection.description);setNotes({});
  },[model]);
  const existing=useMemo(()=>new Set(items.filter(i=>i.state==="available").map(i=>i.documentId)),[items]);
  async function mutate(path:string,method:string,fields:Record<string,unknown>,success:string){
    if(busy)return;
    setBusy(true);setError(null);setMessage(null);
    try {
      const response=await fetch(path,{method,headers:{"Content-Type":"application/json"},
        body:JSON.stringify({...fields,expectedVersion:version})});
      const data=await response.json();
      if(!response.ok) {
        if(response.status===409)throw new Error("This collection changed in another session. Reload to review the latest version.");
        throw new Error(data?.error?.message??"Could not save this collection.");
      }
      if(typeof data.version==="number")setVersion(data.version);
      setMessage(success);router.refresh();
    } catch(cause) {setError(cause instanceof Error?cause.message:"Could not save this collection.");}
    finally{setBusy(false);}
  }
  async function search(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(searching||!query.trim())return;
    setSearching(true);setError(null);
    try{
      const r=await fetch(`/api/workspaces/${workspaceId}/collections/candidates?q=${encodeURIComponent(query.trim())}`,{cache:"no-store"});
      const data=await r.json();if(!r.ok)throw new Error(data?.error?.message??"Could not search documents.");
      setCandidates(data.items??[]);
    }catch(cause){setError(cause instanceof Error?cause.message:"Could not search documents.");}
    finally{setSearching(false);}
  }
  function move(index:number,delta:number){
    const target=index+delta;if(target<0||target>=items.length)return;
    const order=[...items];[order[index],order[target]]=[order[target],order[index]];
    void mutate(`${base}/items/order`,"PUT",{itemIds:order.map(i=>i.id)},"Order saved.");
  }
  async function saveMetadata(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();await mutate(base,"PATCH",{name,description},"Collection updated.");
  }
  return <main className="kh-page pb-8">
    <Link className="kh-focus-ring mb-4 inline-block text-body text-kh-link" href={`/w/${workspaceId}/collections`}>← Collections</Link>
    <h1 className="text-2xl font-semibold text-kh-text">{model.collection.name}</h1>
    {model.collection.description?<p className="mt-1 text-body text-kh-text-muted">{model.collection.description}</p>:null}
    {isArchived?<p className="mt-2 text-body font-medium text-kh-text-muted">Archived — this collection is read-only.</p>:null}
    {error?<div role="alert" className="my-3 text-body text-kh-danger">{error} <button type="button" className="underline" onClick={()=>router.refresh()}>Reload</button></div>:null}
    {message?<p role="status" className="my-3 text-body text-kh-text-muted">{message}</p>:null}
    {canWrite?<div className="mt-4">
      <button disabled={busy} className="kh-control rounded-md border border-kh-border px-3 py-1.5 text-body disabled:opacity-50" onClick={()=>void mutate(base,"PATCH",{status:isArchived?"ACTIVE":"ARCHIVED"},isArchived?"Collection restored.":"Collection archived.")}>{isArchived?"Restore collection":"Archive collection"}</button>
    </div>:null}
    {editable?<form onSubmit={saveMetadata} className="mt-4 rounded-md border border-kh-border p-3">
      <label htmlFor="collection-detail-name" className="block text-caption text-kh-text-muted">Name</label>
      <input id="collection-detail-name" required maxLength={120} value={name} onChange={e=>setName(e.target.value)} className="kh-control mt-1 w-full rounded-md border border-kh-border bg-kh-bg p-2 text-body"/>
      <label htmlFor="collection-detail-description" className="mt-2 block text-caption text-kh-text-muted">Description</label>
      <textarea id="collection-detail-description" maxLength={2000} value={description} onChange={e=>setDescription(e.target.value)} rows={2} className="kh-control mt-1 w-full rounded-md border border-kh-border bg-kh-bg p-2 text-body"/>
      <button type="submit" disabled={busy} className="kh-control mt-2 rounded-md border border-kh-border px-3 py-1.5 text-body disabled:opacity-50">Save details</button>
    </form>:null}
    <h2 className="mb-3 mt-7 text-lg font-semibold text-kh-text">Reading path <span className="text-body font-normal text-kh-text-muted">({items.length})</span></h2>
    {items.length===0?<p className="rounded-md border border-kh-border p-4 text-body text-kh-text-muted">No documents yet. Add a document to build your reading path.</p>:null}
    <ol aria-label="Collection documents" className="divide-y divide-kh-border rounded-md border border-kh-border">
      {items.map((item,index)=><li key={item.id} className="p-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 text-caption tabular-nums text-kh-text-muted">{index+1}.</span>
          <div className="min-w-0 flex-1">
            {item.state==="available"&&item.documentId&&item.sourceId
              ?<><Link className="kh-focus-ring block break-words font-medium text-kh-text hover:text-kh-link" href={`/w/${workspaceId}/knowledge/${item.sourceId}/${item.documentId}`}>{item.title}</Link>
                <span className="text-caption text-kh-text-muted">{item.sourceName}</span>
                {item.readingNote?<p className="mt-1 break-words text-body-sm text-kh-text-muted">{item.readingNote}</p>:null}</>
              :<span className="font-medium text-kh-text-muted">Unavailable document</span>}
            {editable?<div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" aria-label={`Move document ${index+1} up`} disabled={busy||index===0} className="kh-control rounded-md border border-kh-border px-2 py-1 text-caption disabled:opacity-40" onClick={()=>move(index,-1)}>↑</button>
              <button type="button" aria-label={`Move document ${index+1} down`} disabled={busy||index===items.length-1} className="kh-control rounded-md border border-kh-border px-2 py-1 text-caption disabled:opacity-40" onClick={()=>move(index,1)}>↓</button>
              <button type="button" disabled={busy} className="kh-control rounded-md border border-kh-border px-2 py-1 text-caption disabled:opacity-40" onClick={()=>{if(window.confirm("Remove document from this collection?"))void mutate(`${base}/items/${item.id}`,"DELETE",{},"Reference removed.");}}>Remove</button>
            </div>:null}
            {editable?<form className="mt-2 flex min-w-0 gap-2" onSubmit={e=>{e.preventDefault();void mutate(`${base}/items/${item.id}`,"PATCH",{readingNote:notes[item.id]??item.readingNote??""},"Reading note saved.");}}>
              <input aria-label={`Reading note for item ${index+1}`} maxLength={500} value={notes[item.id]??item.readingNote??""} onChange={e=>setNotes(current=>({...current,[item.id]:e.target.value}))} placeholder="Why read this?" className="kh-control min-w-0 flex-1 rounded-md border border-kh-border bg-kh-bg px-2 py-1 text-body"/>
              <button disabled={busy} className="kh-control rounded-md border border-kh-border px-2 py-1 text-caption disabled:opacity-40">Save note</button>
            </form>:null}
          </div>
        </div>
      </li>)}
    </ol>
    {editable?<section className="mt-5 rounded-md border border-kh-border p-3">
      <h2 className="text-body font-semibold">Add document</h2>
      <form className="mt-2 flex gap-2" onSubmit={search}>
        <input aria-label="Find documents" value={query} maxLength={200} onChange={e=>setQuery(e.target.value)} required placeholder="Search document title or content" className="kh-control min-w-0 flex-1 rounded-md border border-kh-border bg-kh-bg p-2 text-body"/>
        <button disabled={busy||searching} className="kh-control rounded-md border border-kh-border px-3 py-2 text-body disabled:opacity-40">{searching?"Searching…":"Search"}</button>
      </form>
      <ul aria-label="Matching documents" className="mt-3 divide-y divide-kh-border">
        {candidates.map(candidate=><li key={candidate.documentId} className="flex items-center justify-between gap-3 py-2">
          <div className="min-w-0"><p className="break-words text-body font-medium">{candidate.title}</p><p className="text-caption text-kh-text-muted">{candidate.sourceName}</p></div>
          <button type="button" disabled={busy||existing.has(candidate.documentId)} className="kh-control shrink-0 rounded-md border border-kh-border px-2 py-1 text-body disabled:opacity-40" onClick={()=>void mutate(`${base}/items`,"POST",{documentId:candidate.documentId,readingNote:""},"Document added.")}>{existing.has(candidate.documentId)?"Added":"Add"}</button>
        </li>)}
      </ul>
    </section>:null}
  </main>;
}
