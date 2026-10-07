import {expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {SyncRunDetailView} from "@/components/sources/sync-run-detail";
import type {SyncRunDetail} from "@/modules/sources/application/get-sync-run-detail";
it("shows the persisted document summary before the reading actions",()=>{
 const detail={source:{id:"s",workspaceId:"w",name:"Folder"},run:{id:"r",status:"APPLIED",resultVersion:2,basedOnVersion:1,summary:{documents:{added:1,updated:2,archived:3},warnings:0},startedAt:new Date("2026-10-03"),completedAt:new Date("2026-10-03")},workspaceType:"PERSONAL",hasRecordedChanges:false,changes:[],nextOrdinal:null} as unknown as SyncRunDetail;
 const html=renderToStaticMarkup(<SyncRunDetailView detail={detail}/>);
 expect(html).toContain("Added 1 · Updated 2 · Archived 3 · Warnings 0");expect(html.indexOf("Added 1")).toBeLessThan(html.indexOf("Browse this folder"));
 // The status is a label, not the stored enum.
 expect(html).toContain(">Synced<");expect(html).not.toContain("APPLIED");
 expect(html).toContain("Document details were not recorded");expect(html).not.toMatch(/[Aa]rticle/);
});
