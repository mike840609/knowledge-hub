"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { CollectionPage } from "@/modules/knowledge/domain/knowledge-collection";

export function CollectionListView({workspaceId,model,status,canWrite}:{
  workspaceId:string; model:CollectionPage; status:"ACTIVE"|"ARCHIVED"; canWrite:boolean;
}) {
  const router=useRouter();
  const [name,setName]=useState("");
  const [description,setDescription]=useState("");
  const [creating,setCreating]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const base=`/w/${workspaceId}/collections`;
  async function create(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(creating)return;setCreating(true);setError(null);
    try {
      const response=await fetch(`/api/workspaces/${workspaceId}/collections`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({name,description})
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data?.error?.message??"Could not create collection.");
      router.push(`${base}/${data.id}`);router.refresh();
    } catch(cause) {setError(cause instanceof Error?cause.message:"Could not create collection.");}
    finally {setCreating(false);}
  }
  return <main className="kh-page pb-8">
    <header className="mb-5">
      <h1 className="text-2xl font-semibold text-kh-text">Collections</h1>
      <p className="mt-1 text-body text-kh-text-muted">Curated reading paths across the knowledge in this Workspace. Original documents stay in their sources.</p>
    </header>
    <nav aria-label="Collection status" className="mb-5 flex gap-3 text-body">
      <Link className={status==="ACTIVE"?"font-semibold text-kh-text":"text-kh-text-muted"} href={base} aria-current={status==="ACTIVE"?"page":undefined}>Active</Link>
      <Link className={status==="ARCHIVED"?"font-semibold text-kh-text":"text-kh-text-muted"} href={`${base}?status=ARCHIVED`} aria-current={status==="ARCHIVED"?"page":undefined}>Archived</Link>
    </nav>
    {canWrite&&status==="ACTIVE"?<form onSubmit={create} className="mb-5 rounded-md border border-kh-border p-4">
      <h2 className="mb-3 text-body font-semibold">Create collection</h2>
      <label htmlFor="collection-name" className="block text-caption text-kh-text-muted">Name</label>
      <input id="collection-name" required maxLength={120} value={name} onChange={e=>setName(e.target.value)} placeholder="Project onboarding" className="kh-control mb-2 mt-1 w-full rounded-md border border-kh-border bg-kh-bg p-2 text-body"/>
      <label htmlFor="collection-description" className="block text-caption text-kh-text-muted">Description (optional)</label>
      <textarea id="collection-description" maxLength={2000} rows={2} value={description} onChange={e=>setDescription(e.target.value)} className="kh-control mt-1 w-full rounded-md border border-kh-border bg-kh-bg p-2 text-body"/>
      <button type="submit" disabled={creating} className="kh-control mt-3 rounded-md bg-kh-primary px-3 py-2 text-body font-medium text-white disabled:opacity-60">{creating?"Creating…":"Create collection"}</button>
    </form>:null}
    {error?<p role="alert" className="mb-3 text-body text-kh-danger">{error}</p>:null}
    {model.items.length===0?<p className="rounded-md border border-kh-border p-6 text-body text-kh-text-muted">{status==="ACTIVE"?"No collections yet. Curate your first reading path.":"No archived collections."}</p>:null}
    <ul aria-label="Collections" className="divide-y divide-kh-border rounded-md border border-kh-border">
      {model.items.map(item=><li key={item.id} className="p-3 hover:bg-kh-bg-hover">
        <Link className="kh-focus-ring block rounded-md font-medium text-kh-text hover:text-kh-link" href={`${base}/${item.id}`}>{item.name}</Link>
        {item.description?<p className="mt-1 text-body-sm text-kh-text-muted">{item.description}</p>:null}
        <p className="mt-1 text-caption text-kh-text-muted">{item.availableItems} available / {item.totalItems} documents</p>
      </li>)}
    </ul>
    {model.nextCursor?<Link className="kh-focus-ring mt-5 inline-block text-body text-kh-link" href={`${base}?status=${status}&cursor=${encodeURIComponent(model.nextCursor)}`}>Next page →</Link>:null}
  </main>;
}
