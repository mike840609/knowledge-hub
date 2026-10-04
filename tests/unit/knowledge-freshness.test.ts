import {describe,it,expect} from "vitest";
import {knowledgeFreshness,validateFreshnessValue,freshnessThreshold} from "@/modules/personal/application/knowledge-freshness";
import type {SourceListItemModel} from "@/server/source-read";
const now=new Date("2026-10-05T00:00:00Z");
function item(days:number|null):SourceListItemModel {
 const completedAt=days===null?null:new Date(now.getTime()-days*86400000);
 const run=completedAt?{id:"run",sourceId:"source",triggeredBy:"user",basedOnVersion:0,resultVersion:1,status:"APPLIED" as const,summary:{},startedAt:completedAt,completedAt}:null;
 return {source:{id:"source",name:"Folder",sourceType:"FOLDER_SYNC",ownership:"SOURCE_MANAGED",status:"ACTIVE"} as SourceListItemModel["source"],latestRun:run,latestSuccessfulRun:run};
}
describe("knowledge freshness",()=>{
 it("uses strict threshold boundary and last successfully applied completion",()=>{
  expect(knowledgeFreshness([item(14)],14,now)).toEqual([]);
  expect(knowledgeFreshness([item(14.01)],14,now)[0].status).toBe("old");
  const preview={...item(30),latestRun:{...item(0).latestRun!,status:"PREVIEWED" as const}};
  expect(knowledgeFreshness([preview],14,now)[0].status).toBe("old");
 });
 it("prioritizes pending preview, failed attempt, then never imported",()=>{
  const failed={...item(null),latestRun:{...item(0).latestRun!,status:"FAILED" as const}};
  expect(knowledgeFreshness([{...failed,pendingPreviewId:"preview"}],14,now)[0].status).toBe("pending");
  expect(knowledgeFreshness([failed],14,now)[0].status).toBe("failed");
  expect(knowledgeFreshness([item(null)],14,now)[0].status).toBe("never");
 });
 it("excludes archived folders and nonfolders regardless of failure",()=>{
  expect(knowledgeFreshness([ {...item(null),source:{...item(null).source,status:"ARCHIVED"}}, {...item(null),source:{...item(null).source,sourceType:"FILE_UPLOAD"}}, {...item(null),source:{...item(null).source,ownership:"HUB_MANAGED"}} ],14,now)).toEqual([]);
 });
 it.each([7,14,30])("validates threshold %s",thresholdDays=>expect(validateFreshnessValue({thresholdDays})).toEqual({thresholdDays}));
 it.each([null,{},[],{thresholdDays:8},{thresholdDays:"14"},{thresholdDays:14,other:true}])("rejects malformed value %j",value=>expect(()=>validateFreshnessValue(value)).toThrow());
 it("defaults invalid stored preferences to 14 days",()=>expect(freshnessThreshold(null)).toBe(14));
});
