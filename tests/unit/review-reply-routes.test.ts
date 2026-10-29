import { afterEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({replyForLink:vi.fn(async()=>({ok:true})),replyForOwner:vi.fn(async()=>({ok:true}))}));
vi.mock("@/server/composition",()=>({applicationServices:()=>({establishTrustedCaller:async()=>({caller:{identity:{id:"me"}}}),reviews:mocks})}));
import { POST as linkReply } from "@/app/api/share-review/threads/[threadId]/replies/route";
import { POST as ownerReply } from "@/app/api/documents/[documentId]/review-threads/[threadId]/replies/route";
afterEach(()=>vi.clearAllMocks());
const url="http://127.0.0.1:3000/api/replies";
const post=(body:unknown)=>new Request(url,{method:"POST",body:JSON.stringify(body),headers:{"content-type":"application/json",Origin:"http://127.0.0.1:3000"}});
describe("reply routes carry mentions",()=>{
 it("a link reply passes its mentions on",async()=>{
  const response=await linkReply(post({token:"t",body:"hi @A",idempotencyKey:"k",mentions:["a"]}),{params:Promise.resolve({threadId:"th"})});
  expect(response.status).toBe(200);
  expect(mocks.replyForLink).toHaveBeenCalledWith(expect.anything(),{token:"t",body:"hi @A",idempotencyKey:"k",mentions:["a"],threadId:"th"});
 });
 it("an owner reply passes its mentions and link on",async()=>{
  const response=await ownerReply(post({body:"hi @A",idempotencyKey:"k",mentions:["a"],mentionLinkId:"l"}),{params:Promise.resolve({documentId:"d",threadId:"th"})});
  expect(response.status).toBe(200);
  expect(mocks.replyForOwner).toHaveBeenCalledWith(expect.anything(),{documentId:"d",threadId:"th",body:"hi @A",idempotencyKey:"k",mentions:["a"],mentionLinkId:"l"});
 });
 it("a reply without a body string is refused before the service",async()=>{
  const response=await linkReply(post({token:"t",idempotencyKey:"k",mentions:["a"]}),{params:Promise.resolve({threadId:"th"})});
  expect(response.status).toBe(400);
  expect(mocks.replyForLink).not.toHaveBeenCalled();
 });
});
