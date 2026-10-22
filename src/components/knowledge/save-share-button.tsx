"use client";
import { Bookmark, BookmarkCheck, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SavedShareState } from "@/modules/knowledge/domain/saved-share";
type LoadState = "loading" | "ready" | "signed-out" | "auth-unavailable" | "error";
export function SaveShareButton({ token }: { token: string }) {
  const [result,setResult]=useState<SavedShareState>();
  const [loadState,setLoadState]=useState<LoadState>("loading");
  const [notice,setNotice]=useState("");
  const [pending,setPending]=useState(false);
  const [retry,setRetry]=useState(0);
  const generation=useRef(0), busy=useRef(false);
  const load=useCallback(async(signal:AbortSignal,version:number)=>{
    try {
      const response=await fetch(`/api/saved-shares/state?${new URLSearchParams({token})}`,{cache:"no-store",signal});
      if(signal.aborted||generation.current!==version)return;
      if(response.status===401){setLoadState("signed-out");return;}
      if(response.status===503){const body=await response.json();if(signal.aborted||generation.current!==version)return;if(body.error?.code==="AUTH_UNAVAILABLE"){setLoadState("auth-unavailable");return;}throw new Error();}
      if(!response.ok)throw new Error();
      const body=await response.json() as SavedShareState;
      if(!signal.aborted&&generation.current===version){setResult(body);setLoadState("ready");}
    }catch{if(!signal.aborted&&generation.current===version){setLoadState("error");setNotice("Could not check saved shares. Retry to check your saved state.");}}
  },[token]);
  useEffect(()=>{
    const controller=new AbortController(),version=++generation.current;
    busy.current=false;setPending(false);setResult(undefined);setNotice("");setLoadState("loading");
    void load(controller.signal,version);
    return ()=>{controller.abort();generation.current++;};
  },[load,retry]);
  async function toggle(){
    if(busy.current)return;
    if(loadState==="loading"||loadState==="error")return;
    // Recheck authentication through the mutation: a sign-in may have completed in another tab.
    const previous=result, removing=!!previous?.saved;
    busy.current=true;setPending(true);setNotice("");const version=generation.current;
    try{
      const response=await fetch(removing?`/api/saved-shares/${previous!.id}`:"/api/saved-shares",{method:removing?"DELETE":"POST",headers:{"Content-Type":"application/json"},...(removing?{}:{body:JSON.stringify({token})})});
      if(version!==generation.current)return;
      if(response.status===401){setLoadState("signed-out");setNotice("Sign in to save this share, then return here to save it.");return;}
      if(!response.ok){const body=await response.json().catch(()=>null);if(version!==generation.current)return;if(body?.error?.code==="AUTH_UNAVAILABLE"){setLoadState("auth-unavailable");setNotice("Sign-in is unavailable right now.");return;}throw new Error();}
      if(removing){setResult({...previous!,saved:false,id:null});setLoadState("ready");setNotice("Removed from saved shares.");}
      else {const saved=await response.json() as SavedShareState;if(version===generation.current){setResult(saved);setLoadState("ready");setNotice("Saved to Shares.");}}
    }catch{if(version===generation.current)setNotice(removing?"Could not remove this saved share. Try again.":"Could not save this share. Try again.");}
    finally{if(version===generation.current){busy.current=false;setPending(false);}}
  }
  const saved=!!result?.saved;
  // The notice floats under the bar it sits in (the nearest positioned box), so the pinned bar never grows.
  return <div className="flex min-w-0 flex-col items-start gap-1">
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" disabled={pending||loadState==="loading"||loadState==="error"} aria-pressed={saved} aria-busy={pending||loadState==="loading"} onClick={()=>void toggle()}>{saved?<BookmarkCheck size={15} aria-hidden="true"/>:<Bookmark size={15} aria-hidden="true"/>}<span className="max-sm:sr-only">{saved?"Saved":"Save share"}</span></Button>
      {(loadState==="error"||loadState==="auth-unavailable")&&<Button variant="ghost" size="sm" disabled={pending} onClick={()=>setRetry(n=>n+1)}>Retry</Button>}
    </div>
    {notice&&<div role="status" className="absolute right-6 top-full z-30 mt-1 flex w-max max-w-[min(theme(maxWidth.panel),calc(100vw-3rem))] items-start gap-2 rounded-md border border-kh-border bg-kh-bg-raised p-3 text-caption text-kh-text-muted shadow-popover"><p>{notice} {loadState==="signed-out"||loadState==="auth-unavailable"?<Link prefetch={false} className="kh-focus-ring rounded-md text-kh-link" href={`/s/${token}/open`}>Open in Knowledge Hub</Link>:saved&&notice==="Saved to Shares."?<Link prefetch={false} className="kh-focus-ring rounded-md text-kh-link" href={`/w/${result!.workspaceId}/shares?tab=saved`}>View saved shares</Link>:null}</p><Button variant="ghost" size="sm" icon aria-label="Dismiss" onClick={()=>setNotice("")}><X className="size-4" aria-hidden="true"/></Button></div>}
  </div>;
}
