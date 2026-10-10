import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertReviewOrigin } from "@/server/review-origin";
import { publicOrigin, reviewWritesEnabled } from "@/server/config";
import { toWorkspaceErrorResponse } from "@/server/http-error-response";
import { AuthRequiredError, AuthUnavailableError } from "@/modules/identity/domain/identity-session-errors";
import { ShareLinkNotFoundError } from "@/modules/knowledge/domain/document-share-link";
const mocks=vi.hoisted(()=>({services:vi.fn(),read:vi.fn()}));
vi.mock("@/server/composition",()=>({applicationServices:mocks.services,reviewReadService:mocks.read}));
import { reviewHttp, ownerReviewHttp } from "@/server/review-http";
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
describe("review request security",()=>{
 it.each([3102,3106])("accepts its own port %s and rejects other origins",port=>{
  const url=`http://127.0.0.1:${port}/api/share-review/threads`;
  expect(()=>assertReviewOrigin(new Request(url,{headers:{Origin:new URL(url).origin}}))).not.toThrow();
  expect(()=>assertReviewOrigin(new Request(url,{headers:{Origin:"http://127.0.0.1:9999"}}))).toThrow();
  expect(()=>assertReviewOrigin(new Request(url))).toThrow();
 });
 describe("behind a gateway, where the request URL is the bind address",()=>{
  const bound="http://127.0.0.1:3000/api/share-review/threads/query";
  const request=(origin?:string)=>new NextRequest(bound,{method:"POST",headers:origin?{Origin:origin}:{}});
  it("accepts the configured public origin",()=>{
   vi.stubEnv("KM_PUBLIC_ORIGIN","https://km.example.com");
   expect(()=>assertReviewOrigin(request("https://km.example.com"))).not.toThrow();
  });
  it("without the setting, rejects the public origin (the defect this setting fixes)",()=>{
   expect(()=>assertReviewOrigin(request("https://km.example.com"))).toThrow();
  });
  it.each(["http://127.0.0.1:3000","http://km.example.com","https://km.example.com:8443","https://evil.km.example.com","https://attacker.invalid","null",undefined])("rejects %s once a public origin is configured",origin=>{
   vi.stubEnv("KM_PUBLIC_ORIGIN","https://km.example.com");
   expect(()=>assertReviewOrigin(request(origin))).toThrow(/same-origin/);
  });
  it("ignores forwarding headers",()=>{
   vi.stubEnv("KM_PUBLIC_ORIGIN","https://km.example.com");
   const forged=new NextRequest(bound,{method:"POST",headers:{Origin:"https://attacker.invalid","X-Forwarded-Host":"attacker.invalid","X-Forwarded-Proto":"https",Host:"attacker.invalid"}});
   expect(()=>assertReviewOrigin(forged)).toThrow(/same-origin/);
  });
  it.each([["https://km.example.com/","https://km.example.com"],[" https://km.example.com/knowledge ","https://km.example.com"],["https://KM.example.com:443","https://km.example.com"],["http://km.example.com:8080","http://km.example.com:8080"]])("reads %s as %s",(raw,expected)=>{
   vi.stubEnv("KM_PUBLIC_ORIGIN",raw);expect(publicOrigin()).toBe(expected);
  });
  it.each(["","   "])("treats a blank setting as unset",raw=>{
   vi.stubEnv("KM_PUBLIC_ORIGIN",raw);expect(publicOrigin()).toBeUndefined();
   expect(()=>assertReviewOrigin(request("http://127.0.0.1:3000"))).not.toThrow();
  });
  it.each(["km.example.com","data:text/plain,x","file:///etc/hosts","null"])("refuses the malformed setting %s instead of accepting any origin",raw=>{
   vi.stubEnv("KM_PUBLIC_ORIGIN",raw);
   expect(()=>publicOrigin()).toThrow(/KM_PUBLIC_ORIGIN/);
   expect(()=>assertReviewOrigin(request("null"))).toThrow();
  });
  it("lets an owner write through from the public origin and still refuses the bind address",async()=>{
   vi.stubEnv("KM_PUBLIC_ORIGIN","https://km.example.com");
   const url="http://127.0.0.1:3000/api/documents/x/review-threads/y/visibility";
   const denied=await ownerReviewHttp(new NextRequest(url,{method:"POST",headers:{Origin:"http://127.0.0.1:3000"}}),vi.fn());
   expect(denied.status).toBe(403);expect(mocks.services).not.toHaveBeenCalled();
   const reviews={};const operation=vi.fn(async()=>({ok:true}));
   mocks.services.mockReturnValue({reviews,establishTrustedCaller:async()=>({caller:{identity:{id:"trusted"}}})});
   await reviewHttp(new NextRequest(bound,{method:"POST",headers:{Origin:"https://km.example.com"}}),operation);
   expect(operation).toHaveBeenCalledTimes(1);
  });
 });
 it("keeps writes default off",()=>{
  vi.stubEnv("KM_REVIEW_WRITES_ENABLED","");expect(reviewWritesEnabled()).toBe(false);
  vi.stubEnv("KM_REVIEW_WRITES_ENABLED","true");expect(reviewWritesEnabled()).toBe(true);
 });
 it.each([[new AuthRequiredError(),401],[new AuthUnavailableError(),503],[new ShareLinkNotFoundError(),404]] as const)("maps typed errors privately",async(error,status)=>{
  const operation=vi.fn();mocks.services.mockImplementation(()=>{throw error;});
  const response=await reviewHttp(new Request("http://localhost/api/share-review/threads/query",{method:"POST",headers:{Origin:"http://localhost"}}),operation);
  expect(response.status).toBe(status);expect(response.headers.get("cache-control")).toBe("private, no-store");expect(operation).not.toHaveBeenCalled();expect(await response.json()).toEqual(toWorkspaceErrorResponse(error).body);
 });
 it("uses only trusted caller and ignores browser identity fields",async()=>{
  const caller={identity:{id:"trusted"}};const service={};mocks.services.mockReturnValue({reviews:service,establishTrustedCaller:async()=>({caller})});
  const operation=vi.fn(async()=>({ok:true}));await reviewHttp(new Request("http://localhost/api/share-review/threads/query",{method:"POST",headers:{Origin:"http://localhost","emp_id":"forged"},body:JSON.stringify({emp_id:"forged"})}),operation);
  expect(operation).toHaveBeenCalledWith(service,caller);
 });
 it("rejects cross-origin owner writes before authentication or provisioning",async()=>{
  const response=await ownerReviewHttp(new Request("http://localhost/api/documents/x/review-threads/y/visibility",{method:"POST",headers:{Origin:"http://attacker.invalid"}}),vi.fn());
  expect(response.status).toBe(403);expect(response.headers.get("cache-control")).toBe("private, no-store");expect(mocks.services).not.toHaveBeenCalled();
 });

 it("uses the original trusted NextRequest URL despite loopback normalization",()=>{
  const url="http://127.0.0.1:3106/api/share-review/threads/query";
  const request=new NextRequest(url,{headers:{Origin:"http://127.0.0.1:3106"}});
  expect(new URL(request.url).origin).toBe("http://localhost:3106");
  expect(()=>assertReviewOrigin(request)).not.toThrow();
  for(const origin of ["http://localhost:3106","http://127.0.0.1:3102","https://127.0.0.1:3106"])expect(()=>assertReviewOrigin(new NextRequest(url,{headers:{Origin:origin}}))).toThrow();
 });

 it("uses the actual Request superclass getter across constructor realms",()=>{
  class ForeignRequest {
    #url:string;
    headers:Headers;
    constructor(url:string,origin:string) {this.#url=url;this.headers=new Headers({Origin:origin});}
    get url() {return this.#url;}
  }
  class NormalizedRequest extends ForeignRequest {get url() {return super.url.replace("127.0.0.1","localhost");}}
  const url="http://127.0.0.1:3106/api/share-review/threads/query";
  expect(()=>assertReviewOrigin(new NormalizedRequest(url,"http://127.0.0.1:3106") as unknown as Request)).not.toThrow();
  expect(()=>assertReviewOrigin(new NormalizedRequest(url,"http://localhost:3106") as unknown as Request)).toThrow();
 });

 it("keeps every private review route force-dynamic to preserve the original Request",()=>{
  const routes=["share-review/threads/query","share-review/threads","share-review/threads/[threadId]/replies","documents/[documentId]/review-threads","documents/[documentId]/review-threads/[threadId]/replies","documents/[documentId]/review-threads/[threadId]/resolution","documents/[documentId]/review-threads/[threadId]/visibility","documents/[documentId]/review-threads/[threadId]/comments/[commentId]/visibility"];
  for(const route of routes)expect(readFileSync(`src/app/api/${route}/route.ts`,"utf8")).toContain('export const dynamic = "force-dynamic"');
 });

});

it.each([new AuthRequiredError(), new AuthUnavailableError()])("permits public review reads when identity is unavailable, while writes remain authenticated", async error => {
 const { reviewReadHttp } = await import("@/server/review-http");
 const establishTrustedCaller = vi.fn().mockRejectedValue(error);
 const reviews = {}; mocks.read.mockReturnValue(reviews); mocks.services.mockReturnValue({ reviews, establishTrustedCaller });
 const operation = vi.fn(async (_service, caller) => ({ callerUserId: caller?.identity.id ?? null, threads: [] }));
 const request = () => new Request("http://localhost/api/share-review/threads/query", { method: "POST", headers: { Origin: "http://localhost" } });
 const response = await reviewReadHttp(request(), operation);
 expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
 expect(operation).toHaveBeenCalledWith(reviews, null);
 operation.mockClear();
 expect((await reviewHttp(request(), operation)).status).toBe(error instanceof AuthRequiredError ? 401 : 503);
 expect(operation).not.toHaveBeenCalled();
});

it("rejects cross-origin public reads before looking up identity or comments", async () => {
 const { reviewReadHttp } = await import("@/server/review-http");
 const operation = vi.fn();
 const response = await reviewReadHttp(new Request("http://localhost/api/share-review/threads/query", { method: "POST", headers: { Origin: "https://other.invalid" } }), operation);
 expect(response.status).toBe(403); expect(mocks.services).not.toHaveBeenCalled(); expect(operation).not.toHaveBeenCalled();
});

it("reads via the dedicated projection when SSO service construction fails", async () => {
 const { reviewReadHttp } = await import("@/server/review-http");
 mocks.services.mockImplementation(() => { throw new AuthUnavailableError(); });
 const reviews = {}; mocks.read.mockReturnValue(reviews);
 const operation = vi.fn(async () => ({ threads: [] }));
 const response = await reviewReadHttp(new Request("http://localhost/api/share-review/threads/query", { method: "POST", headers: { Origin: "http://localhost" } }), operation);
 expect(response.status).toBe(200); expect(operation).toHaveBeenCalledWith(reviews, null);
});
