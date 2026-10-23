// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FollowedDiscussionsView } from "@/components/knowledge/followed-discussions-view";
import type { FollowedDiscussionView } from "@/modules/knowledge/domain/review-follow";
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root;
beforeEach(()=>{host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const live:FollowedDiscussionView={threadId:"t1",linkAvailable:true,token:"tok",documentTitle:"A useful guide",threadStatus:"OPEN",authorName:"Owner",excerpt:"Owner answers",latestAt:new Date(),unread:2};
const dead:FollowedDiscussionView={threadId:"t2",linkAvailable:false};
const mount=async(items=[live,dead],filter:"all"|"unread"="all")=>{await act(async()=>root.render(<FollowedDiscussionsView workspaceId="reader" items={items} filter={filter} unread={items.filter(i=>i.linkAvailable&&i.unread>0).length}/>));};

it("is the active Shares tab and counts unread discussions on its label",async()=>{
 await mount();
 const tab=host.querySelector('a[aria-current="page"]')!;
 expect(tab.textContent).toContain("Discussions");
 expect(tab.querySelector('[aria-label="1 unread"]')?.textContent).toBe("1");
});
it("links a live row to the discussion on the shared page and shows what is new",async()=>{
 await mount();
 const row=host.querySelector('a[href="/s/tok?thread=t1"]');expect(row?.textContent).toContain("A useful guide");
 expect(host.textContent).toContain("Owner answers");expect(host.textContent).toContain("2 new replies");expect(host.textContent).toContain("Open");
});
it("a dead link's row names nothing and offers Remove",async()=>{
 await mount([dead]);
 expect(host.querySelector('li[data-thread-id="t2"]')).not.toBeNull();
 expect(host.textContent).toContain("A shared discussion — this link is no longer available");
 expect(host.querySelector('a[href^="/s/"]')).toBeNull();
 expect(host.querySelector('button[aria-label="Remove discussion"]')).not.toBeNull();
});
it("Unfollow uses the link; Remove uses the caller's own follow; a failure keeps the row",async()=>{
 const calls:string[]=[];let fail=true;
 vi.stubGlobal("fetch",async(url:string,init:RequestInit)=>{calls.push(`${url} ${init.body??""}`);if(fail)return new Response(null,{status:500});return Response.json({following:false});});
 await mount();
 await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Unfollow: A useful guide"]')!.click());
 expect(host.textContent).toContain("Could not update this discussion. Try again.");expect(host.textContent).toContain("A useful guide");
 fail=false;
 await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Unfollow: A useful guide"]')!.click());
 expect(host.textContent).not.toContain("A useful guide");
 await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Remove discussion"]')!.click());
 expect(calls).toContain(`/api/share-review/threads/t1/follow ${JSON.stringify({token:"tok",following:false})}`);
 expect(calls).toContain("/api/review-follows/t2/unfollow ");
 expect(host.textContent).toContain("Discussions you comment on through a shared link appear here.");
});
it("shows Untitled when the discussion's document has no current title",async()=>{
 await mount([{ ...live, documentTitle: "" }]);
 expect(host.textContent).toContain("Untitled");
 expect(host.querySelector('button[aria-label="Unfollow: Untitled"]')).not.toBeNull();
});
it("the filter submits tab=discussions with the chosen status",async()=>{
 await mount([live],"unread");
 expect(host.querySelector('input[name="tab"]')?.getAttribute("value")).toBe("discussions");
 expect(host.querySelector('#discussions-status')?.getAttribute("data-value")).toBe("unread");
});
it("a filter error is shown in place of the list and its empty state",async()=>{
 await act(async()=>root.render(<FollowedDiscussionsView workspaceId="reader" items={[]} filter="all" unread={3} filterError="Choose All or Unread."/>));
 expect(host.querySelector('[role="alert"]')?.textContent).toBe("Choose All or Unread.");
 expect(host.textContent).not.toContain("No discussions yet.");
 expect(host.querySelector('[aria-label="3 unread"]')).not.toBeNull();
});
