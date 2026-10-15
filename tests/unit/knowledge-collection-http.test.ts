import { beforeEach, expect, it, vi } from "vitest";
import { KnowledgeCollectionError } from "@/modules/knowledge/domain/knowledge-collection-errors";
import { toWorkspaceErrorResponse } from "@/server/http-error-response";
import { AuthRequiredError,AuthUnavailableError } from "@/modules/identity/domain/identity-session-errors";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
const fixture=vi.hoisted(()=>({error:null as Error|null}));
vi.mock("@/server/composition",()=>({applicationServices:()=>({
  establishTrustedCaller:async()=>{if(fixture.error)throw fixture.error;return{
    caller:callerFromIdentity({id:"0199f000-0000-7000-8000-000000000101",emp_id:"U",name:"Test",org_code:"ORG"})};},
  collections:{get:async()=>({collection:{id:"c"},items:[]})},
})}));
import { collectionHttp } from "@/server/collection-http";

beforeEach(()=>{fixture.error=null;vi.stubEnv("KM_PUBLIC_ORIGIN","");});

it.each([
  ["COLLECTION_NOT_FOUND",404],
  ["COLLECTION_FORBIDDEN",403],
  ["COLLECTION_INVALID",400],
  ["COLLECTION_CONFLICT",409],
  ["COLLECTION_DUPLICATE_ITEM",409],
  ["COLLECTION_LIMIT",422],
] as const)("maps %s into %s without SQL details",(code,status)=>{
  const result=toWorkspaceErrorResponse(new KnowledgeCollectionError(code,"Collection operation failed."));
  expect(result.status).toBe(status);
  expect(JSON.stringify(result.body)).not.toContain("SQL");
});

it("distinguishes missing login from unavailable identity",async()=>{
  for(const [error,status] of [[new AuthRequiredError(),401],[new AuthUnavailableError(),503]] as const){
    fixture.error=error;
    const result=await collectionHttp(new Request("http://hub.test/api"),async()=>({ok:true}));
    expect(result.status).toBe(status);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
  }
});

it("blocks cross-origin writes and does not execute handler",async()=>{
  let called=false;
  const result=await collectionHttp(new Request("http://hub.test/api",{method:"POST",headers:{origin:"http://foreign.test"}}),
    async()=>{called=true;return {};});
  expect(result.status).toBe(403);
  expect(called).toBe(false);
});

it("returns authenticated JSON with no-cache",async()=>{
  const result=await collectionHttp(new Request("http://hub.test/api"),async()=>({items:[]}));
  expect(result.status).toBe(200);
  expect(result.headers.get("cache-control")).toBe("private, no-store");
  expect(await result.json()).toEqual({items:[]});
});
