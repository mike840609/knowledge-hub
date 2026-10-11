"use client";
import { Bookmark, BookmarkCheck } from "lucide-react";
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
    if(loadState==="signed-out"){setNotice("Sign in to save this share, then return here to save it.");return;}
    if(loadState==="auth-unavailable"){setNotice("Sign-in is unavailable right now. Try again later.");return;}
    if(loadState!=="ready"||!result)return;
    busy.current=true;setPending(true);setNotice("");const version=generation.current;
    try{
      const response=await fetch(result.saved?`/api/saved-shares/${result.id}`:"/api/saved-shares",{method:result.saved?"DELETE":"POST",headers:{"Content-Type":"application/json"},...(result.saved?{}:{body:JSON.stringify({token})})});
      if(version!==generation.current)return;
      if(response.status===401){setLoadState("signed-out");setNotice("Sign in to save this share, then return here to save it.");return;}
      if(!response.ok){const body=await response.json().catch(()=>null);if(version!==generation.current)return;if(body?.error?.code==="AUTH_UNAVAILABLE"){setLoadState("auth-unavailable");setNotice("Sign-in is unavailable right now.");return;}throw new Error();}
      if(result.saved){setResult({...result,saved:false,id:null});setNotice("Removed from saved shares.");}
      else {const saved=await response.json() as SavedShareState;if(version===generation.current){setResult(saved);setNotice("Saved to Shares.");}}
    }catch{if(version===generation.current)setNotice(result.saved?"Could not remove this saved share. Try again.":"Could not save this share. Try again.");}
    finally{if(version===generation.current){busy.current=false;setPending(false);}}
  }
  const saved=!!result?.saved;
  return <div className="flex min-w-0 flex-col items-start gap-1">
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" disabled={pending||loadState==="loading"||loadState==="error"} aria-pressed={saved} aria-busy={pending||loadState==="loading"} onClick={()=>void toggle()}>{saved?<BookmarkCheck size={15} aria-hidden="true"/>:<Bookmark size={15} aria-hidden="true"/>}{saved?"Saved":"Save share"}</Button>
      {(loadState==="error"||loadState==="auth-unavailable")&&<Button variant="ghost" size="sm" disabled={pending} onClick={()=>setRetry(n=>n+1)}>Retry</Button>}
    </div>
    {notice&&<p role="status" className="max-w-panel text-caption text-kh-text-muted">{notice} {loadState==="signed-out"||loadState==="auth-unavailable"?<Link prefetch={false} className="kh-focus-ring rounded-md text-kh-link" href={`/s/${token}/open`}>Open in Knowledge Hub</Link>:saved&&notice==="Saved to Shares."?<Link prefetch={false} className="kh-focus-ring rounded-md text-kh-link" href={`/w/${result!.workspaceId}/shares?tab=saved`}>View saved shares</Link>:null}</p>}
  </div>;
}
