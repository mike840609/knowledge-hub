// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SavedSharesView } from "@/components/knowledge/saved-shares-view";
import type { SavedShareList } from "@/modules/knowledge/domain/saved-share";
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root;
beforeEach(()=>{host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const model:SavedShareList={query:{q:"",status:"all",page:1},hasNext:false,items:[]};
const named=[{linkId:"l1",title:"Quarterly plan",sharedByName:"List Owner",addedAt:new Date(),href:"/w/me/shares/tok1"},{linkId:"l2",title:"Reading list",sharedByName:"Other",addedAt:new Date(),href:"/w/me/shares/tok2"}];
const mount=async(shared?:typeof named)=>{await act(async()=>root.render(<SavedSharesView workspaceId="me" model={model} sharedWithYou={shared}/>));};
it("lists each named share above the saved list, linking to its share page",async()=>{
 await mount(named);
 const section=host.querySelector('section[aria-label="Shared with you"]')!;expect(section).not.toBeNull();
 expect(section.querySelector('a[href="/w/me/shares/tok1"]')?.textContent).toContain("Quarterly plan");
 expect(section.querySelector('a[href="/w/me/shares/tok2"]')?.textContent).toContain("Reading list");
 expect(section.textContent).toContain("Shared by List Owner");
 expect(section.compareDocumentPosition(host.querySelector('form[aria-label="Filter saved shares"]')!)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(host.querySelector('button[aria-label^="Remove saved share"]')).toBeNull();
});
it("hides the section when nothing is shared with the reader",async()=>{
 await mount([]);expect(host.querySelector('section[aria-label="Shared with you"]')).toBeNull();expect(host.textContent).not.toContain("Shared with you");
 await mount(undefined);expect(host.querySelector('section[aria-label="Shared with you"]')).toBeNull();
});
it("shows the section only on the unfiltered first page, where it belongs above the whole list",async()=>{
 for(const query of [{q:"plan",status:"all",page:1},{q:"",status:"available",page:1},{q:"",status:"all",page:2}] as const){
  await act(async()=>root.render(<SavedSharesView workspaceId="me" model={{...model,query}} sharedWithYou={named}/>));
  expect(host.querySelector('section[aria-label="Shared with you"]')).toBeNull();
 }
});
it("an owner without a name is left out rather than shown as an empty 'Shared by'",async()=>{
 await mount([{...named[0],sharedByName:""}]);
 const line=host.querySelector('section[aria-label="Shared with you"] li p')!;
 expect(line.textContent).not.toContain("Shared by");
 expect(line.textContent?.startsWith(" ·")).toBe(false);
});
