import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { SavedShareService } from "@/modules/knowledge/application/saved-share-service";
import { DocumentShareService } from "@/modules/knowledge/application/document-share-service";
import { RandomShareTokenIssuer } from "@/infrastructure/security/random-share-token-issuer";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { callerFromIdentity, type CallerContext } from "@/modules/identity/domain/caller-context";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { AuthRequiredError } from "@/modules/identity/domain/identity-session-errors";
const injected=vi.hoisted(()=>({ caller:null as unknown, savedShares:null as unknown }));
vi.mock("@/server/composition",()=>({applicationServices:()=>({establishTrustedCaller:async()=>{if(!injected.caller)throw new AuthRequiredError();return {caller:injected.caller};},savedShares:injected.savedShares})}));
import { POST } from "@/app/api/saved-shares/route";
import { GET as state } from "@/app/api/saved-shares/state/route";
import { DELETE } from "@/app/api/saved-shares/[id]/route";
import { GET as list } from "@/app/api/workspaces/[workspaceId]/saved-shares/route";
let pool:Pool, uow:MariaDbUnitOfWork;
beforeAll(()=>{pool=createDatabasePool(databaseConfig("test"));uow=new MariaDbUnitOfWork(pool);injected.savedShares=new SavedShareService(uow);});
afterAll(async()=>pool.end());beforeEach(()=>{vi.stubEnv("KM_PUBLIC_ORIGIN","");injected.caller=null;});
const request=(body:unknown)=>new Request("http://hub.test/api/saved-shares",{method:"POST",headers:{origin:"http://hub.test","content-type":"application/json"},body:JSON.stringify(body)});
async function user() {const id=uuidv7(),caller=callerFromIdentity({id,emp_id:`SAVE-API-${id}`,name:"API Reader",org_code:"SAVE"});await uow.run(r=>r.users.upsertIdentity(caller.identity));const {workspace}=await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(id);return {caller,workspace};}
async function share() {const owner=await user();const sourceId=await ensureDefaultHubSource(uow,owner.caller,owner.workspace.id);const {documentId}=await new HubKnowledgeCommandServiceImpl(uow).createDocument(owner.caller,{sourceId,parentId:null,title:"Shared API",markdown:"body",metadata:{}});const shares=new DocumentShareService(uow,new RandomShareTokenIssuer());const link=await shares.create(owner.caller,{documentId});return {...owner,shares,link,token:link.path.slice(3)};}
it("requires trusted callers on every endpoint and private error caching",async()=>{
 for(const response of [await POST(request({token:crypto.randomUUID()})),await state(new Request(`http://hub.test/api/saved-shares/state?token=${crypto.randomUUID()}`)),await list(new Request("http://hub.test/api"),{params:Promise.resolve({workspaceId:uuidv7()})}),await DELETE(new Request("http://hub.test/api",{method:"DELETE",headers:{origin:"http://hub.test"}}),{params:Promise.resolve({id:uuidv7()})})]) {expect(response.status).toBe(401);expect(response.headers.get("cache-control")).toBe("private, no-store");}
});
it("saves for caller only, deduplicates, lists and removes after revocation",async()=>{
 const owner=await share(),reader=await user();injected.caller=reader.caller;
 const response=await POST(request({token:owner.token,userId:owner.caller.identity.id}));expect(response.status).toBe(200);const record=await response.json();expect(record.workspaceId).toBe(reader.workspace.id);
 expect(await (await POST(request({token:owner.token}))).json()).toEqual(record);
 expect(await (await state(new Request(`http://hub.test/api/saved-shares/state?token=${owner.token}`))).json()).toEqual(record);
 const listing=await list(new Request("http://hub.test/api"),{params:Promise.resolve({workspaceId:reader.workspace.id})});expect(listing.status).toBe(200);expect((await listing.json()).items).toHaveLength(1);expect(listing.headers.get("cache-control")).toBe("private, no-store");
 injected.caller=owner.caller;expect((await DELETE(new Request("http://hub.test/api",{method:"DELETE",headers:{origin:"http://hub.test"}}),{params:Promise.resolve({id:record.id})})).status).toBe(404);
 await owner.shares.revoke(owner.caller,owner.link.id);injected.caller=reader.caller;
 const removed=await DELETE(new Request("http://hub.test/api",{method:"DELETE",headers:{origin:"http://hub.test"}}),{params:Promise.resolve({id:record.id})});expect(removed.status).toBe(204);expect(await removed.text()).toBe("");
 expect((await POST(request({token:owner.token}))).status).toBe(404);
});
it("rejects malformed bodies, invalid tokens and foreign origins",async()=>{
 injected.caller=(await user()).caller as CallerContext;
 for(const body of [null,[],{}, {token:7}])expect((await POST(request(body))).status).toBe(400);
 expect((await POST(request({token:"bad"}))).status).toBe(404);
 const malformed=new Request("http://hub.test/api",{method:"POST",headers:{origin:"http://hub.test"},body:"{"});expect((await POST(malformed)).status).toBe(400);
 const forbidden=new Request("http://hub.test/api",{method:"POST",headers:{origin:"http://evil.test"},body:"{}"});expect((await POST(forbidden)).status).toBe(403);
});
