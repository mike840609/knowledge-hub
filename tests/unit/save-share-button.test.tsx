// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SaveShareButton } from "@/components/knowledge/save-share-button";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host:HTMLDivElement,root:Root;
beforeEach(()=>{host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const state={saved:false,id:null,workspaceId:"reader"};
const mount=async(token="token")=>{await act(async()=>root.render(<SaveShareButton token={token}/>));};
const click=async(name:string)=>{await act(async()=>[...host.querySelectorAll("button")].find(b=>b.textContent===name)!.click());};
it("loads saved state and removes without revoking",async()=>{
 vi.stubGlobal("fetch",async(_url:string,init?:RequestInit)=>init?.method==="DELETE" ? new Response(null,{status:204}) : Response.json({...state,saved:true,id:"record"}));
 await mount();expect(host.querySelector("button")?.getAttribute("aria-pressed")).toBe("true");
 await click("Saved");expect(host.querySelector("button")?.textContent).toBe("Save share");expect(host.textContent).toContain("Removed from saved shares");
});
it("saves and links to the recipient's Shares page",async()=>{
 vi.stubGlobal("fetch",async(_url:string,init?:RequestInit)=>Response.json(init?.method==="POST"?{...state,saved:true,id:"record"}:state));
 await mount();await click("Save share");expect(host.textContent).toContain("Saved to Shares");expect(host.querySelector('a[href="/w/reader/shares?tab=saved"]')).not.toBeNull();
});
it("disables pending duplicate clicks and waits for server confirmation",async()=>{
 let finish:(r:Response)=>void=()=>{};
 vi.stubGlobal("fetch",async(_url:string,init?:RequestInit)=>init?.method==="POST"?new Promise<Response>(r=>{finish=r;}):Response.json(state));
 await mount();await click("Save share");expect(host.querySelector("button")?.disabled).toBe(true);expect(host.textContent).not.toContain("Saved to Shares");
 await act(async()=>finish(Response.json({...state,saved:true,id:"record"})));expect(host.textContent).toContain("Saved to Shares");
});
it.each([[401,"AUTH_REQUIRED","Sign in to save"],[503,"AUTH_UNAVAILABLE","Sign-in is unavailable"]])("keeps anonymous reading usable for %s",async(status,code,text)=>{
 vi.stubGlobal("fetch",async()=>Response.json({error:{code,message:text}},{status}));await mount();await click("Save share");expect(host.textContent).toContain(text);expect(host.querySelector('a[href="/s/token/open"]')).not.toBeNull();
});
it("retains state after failed write and retries",async()=>{
 let failed=true;vi.stubGlobal("fetch",async(_url:string,init?:RequestInit)=>{
 if(init?.method==="POST"&&failed)throw new Error("Network down");return Response.json(init?.method==="POST"?{...state,saved:true,id:"record"}:state);
 });await mount();await click("Save share");expect(host.querySelector("button")?.textContent).toBe("Save share");expect(host.textContent).toContain("Could not save");failed=false;await click("Save share");expect(host.textContent).toContain("Saved to Shares");
});
it("offers retry after failed initial state load",async()=>{
 let failed=true;vi.stubGlobal("fetch",async()=>{if(failed)throw new Error("offline");return Response.json(state);});await mount();expect(host.textContent).toContain("Retry");failed=false;await click("Retry");expect(host.querySelector("button")?.textContent).toBe("Save share");
});
it("ignores previous article state when token changes",async()=>{
 let finish:(r:Response)=>void=()=>{};vi.stubGlobal("fetch",async(url:string)=>url.includes("token=old")?new Promise<Response>(r=>{finish=r;}):Response.json(state));
 await mount("old");await mount("new");await act(async()=>finish(Response.json({...state,saved:true,id:"old-record"})));expect(host.querySelector("button")?.getAttribute("aria-pressed")).toBe("false");
});
it("ignores delayed auth error parsing from a previous article",async()=>{
 let finish:(value:unknown)=>void=()=>{};const old=new Response("",{status:503});vi.spyOn(old,"json").mockImplementation(()=>new Promise(r=>{finish=r;}));
 vi.stubGlobal("fetch",async(url:string,init?:RequestInit)=>url.includes("token=old")?old:Response.json(init?.method==="POST"?{...state,saved:true,id:"new-record"}:state));
 await mount("old");await mount("new");await act(async()=>finish({error:{code:"AUTH_UNAVAILABLE"}}));await click("Save share");expect(host.textContent).toContain("Saved to Shares");
});
it("can save after sign-in completes in another tab without reloading the article",async()=>{
 let signedIn=false;vi.stubGlobal("fetch",async(_url:string,init?:RequestInit)=>signedIn?Response.json(init?.method==="POST"?{...state,saved:true,id:"record"}:state):Response.json({error:{code:"AUTH_REQUIRED"}},{status:401}));
 await mount();await click("Save share");expect(host.textContent).toContain("Sign in to save");signedIn=true;await click("Save share");expect(host.textContent).toContain("Saved to Shares");
});
