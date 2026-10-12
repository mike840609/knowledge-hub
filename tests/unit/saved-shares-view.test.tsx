// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SavedSharesView } from "@/components/knowledge/saved-shares-view";
import type { SavedShareList } from "@/modules/knowledge/domain/saved-share";
import { userGuideContent } from "@/components/help/user-guide-content";
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root;
beforeEach(()=>{host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const model:SavedShareList={query:{q:"",status:"all",page:1},hasNext:false,items:[{id:"saved",title:"A useful guide",sharedByName:"Someone",status:"available",savedAt:new Date(),expiresAt:new Date(Date.now()+86400000),updatedAt:new Date(),path:"/s/live-token"}]};
const mount=async(value=model)=>{await act(async()=>root.render(<SavedSharesView workspaceId="reader" model={value}/>));};
it("separates saved shares, preserves route filters and links only to the public reader",async()=>{
 await mount({...model,query:{q:"guide",status:"all",page:2},hasNext:true});
 expect(host.querySelector('a[aria-current="page"]')?.textContent).toBe("Saved shares");expect(host.querySelector('a[href="/w/reader/shares"]')).not.toBeNull();expect(host.querySelector('a[href="/s/live-token"]')).not.toBeNull();
 expect(host.querySelector('input[name="tab"]')?.getAttribute("value")).toBe("saved");const next=[...host.querySelectorAll("a")].find(x=>x.textContent==="Next");expect(next?.getAttribute("href")).toContain("tab=saved");expect(next?.getAttribute("href")).toContain("page=3");
 expect(host.textContent).not.toContain("Revoke");expect(host.textContent).not.toContain("Views");expect(host.textContent).not.toContain("Favorite");
});
it("unavailable articles retain snapshot information and remain removable",async()=>{
 await mount({...model,items:[{...model.items[0],status:"unavailable",path:null,updatedAt:null}]});expect(host.textContent).toContain("Link unavailable");expect(host.textContent).toContain("A useful guide");expect(host.querySelector('a[href^="/s/"]')).toBeNull();expect(host.querySelector('button[aria-label="Remove saved share: A useful guide"]')).not.toBeNull();
});
it("failed removal keeps the row and successful retry removes it",async()=>{
 let failed=true;vi.stubGlobal("fetch",async()=>{if(failed)throw new Error("offline");return new Response(null,{status:204});});await mount();
 const remove=()=>host.querySelector<HTMLButtonElement>('button[aria-label="Remove saved share: A useful guide"]')!;
 await act(async()=>remove().click());expect(host.textContent).toContain("Could not remove");expect(host.textContent).toContain("A useful guide");failed=false;await act(async()=>remove().click());expect(host.textContent).not.toContain("A useful guide");expect(host.textContent).toContain("No saved shares yet");
});
it("explains empty and filtered empty states",async()=>{
 await mount({...model,items:[]});expect(host.textContent).toContain("Save share");await mount({...model,items:[],query:{q:"missing",status:"all",page:1}});expect(host.textContent).toContain("No saved shares match");expect(host.textContent).toContain("Clear filters");
});
it.each(["en","zh-TW"] as const)("explains saved shares versus favorites in %s guide",locale=>{
 const text=JSON.stringify(userGuideContent(locale));expect(text).toContain("Saved shares");expect(text).toContain("Save share");expect(text).toContain(locale==="en"?"favorites":"最愛");
});
it("refresh can show a share re-saved on another device after local removal",async()=>{
 vi.stubGlobal("fetch",async()=>new Response(null,{status:204}));await mount();await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Remove saved share: A useful guide"]')!.click());expect(host.textContent).not.toContain("A useful guide");
 await mount({...model,items:[]});await mount({...model,items:[{...model.items[0],savedAt:new Date(Date.now()+1000)}]});expect(host.textContent).toContain("A useful guide");
});
