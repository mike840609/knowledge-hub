// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {afterEach,expect,it,vi} from "vitest";
import {ImportContentDiff} from "@/components/imports/import-content-diff";
afterEach(()=>vi.unstubAllGlobals());
it("loads a selected diff on demand and bounds its first render, while letting the reader reveal more",async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  const fetch=vi.fn(async()=>Response.json({before:{title:"Old",markdown:Array.from({length:150},(_,i)=>`old ${i}`).join("\n")},after:{title:"New",markdown:Array.from({length:150},(_,i)=>`new ${i}`).join("\n")}}));vi.stubGlobal("fetch",fetch);
  const container=document.createElement("div");const root=createRoot(container);
  try{await act(async()=>root.render(<ImportContentDiff snapshotId="snapshot" sourcePath="folder/note.md"/>));expect(fetch).not.toHaveBeenCalled();
    await act(async()=>container.querySelector<HTMLButtonElement>("button")!.click());
    expect(fetch).toHaveBeenCalledWith("/api/source-imports/snapshot/content-diff?path=folder%2Fnote.md",{cache:"no-store"});
    expect(container.querySelectorAll("tbody tr")).toHaveLength(100);
    const more=[...container.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent==="Show more changed lines")!;
    await act(async()=>more.click());expect(container.querySelectorAll("tbody tr")).toHaveLength(200);
    await act(async()=>container.querySelector<HTMLButtonElement>("button")!.click());expect(container.querySelector("table")).toBeNull();
  }finally{await act(async()=>root.unmount());}
});
