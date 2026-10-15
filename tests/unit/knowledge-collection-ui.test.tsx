import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CollectionListView } from "@/components/knowledge/collection-list";
import { CollectionDetailView } from "@/components/knowledge/collection-detail";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const id="0199b29e-ef74-74ec-8abe-dcdf8651b811";
const stamp=new Date("2026-10-15T09:01:02Z");
const collection={id,workspaceId:id,name:"Onboarding",description:"Read first",version:1,status:"ACTIVE" as const,
  createdBy:id,updatedBy:id,archivedBy:null,archivedAt:null,createdAt:stamp,updatedAt:stamp};
describe("collection UI",()=>{
 it("shows collection list and prevents viewer creation",()=>{
  const html=renderToStaticMarkup(<CollectionListView workspaceId={id} model={{items:[{...collection,availableItems:1,totalItems:1}],nextCursor:null}} canWrite={false} status="ACTIVE"/>);
  expect(html).toContain("Onboarding");
  expect(html).not.toContain("Create collection");
 });
 it("shows available item with its read path and annotation",()=>{
  const html=renderToStaticMarkup(<CollectionDetailView workspaceId={id} model={{collection,items:[{id,position:0,state:"available",documentId:id,sourceId:id,title:"Architecture",sourceName:"Engineering",readingNote:"Start here"}]}} canWrite={false}/>);
  expect(html).toContain("Architecture");
  expect(html).toContain("Start here");
  expect(html).toContain("/knowledge/");
 });
 it("never shows metadata from an unavailable item",()=>{
  const html=renderToStaticMarkup(<CollectionDetailView workspaceId={id} model={{collection,items:[{id,position:0,state:"unavailable"}]}} canWrite={true}/>);
  expect(html).toContain("Unavailable document");
  expect(html).not.toContain("Start here");
  expect(html).not.toContain("/knowledge/");
 });
 it("escapes annotation markup rather than executing it",()=>{
  const note='<img src=x onerror=alert(1)>';
  const html=renderToStaticMarkup(<CollectionDetailView workspaceId={id} model={{collection,items:[{id,position:0,state:"available",documentId:id,sourceId:id,title:"Safe",sourceName:"Engineering",readingNote:note}]}} canWrite={false}/>);
  expect(html).toContain("&lt;img");
  expect(html).not.toContain("<img src=x");
 });
});
