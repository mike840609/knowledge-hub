import { beforeEach, expect, it, vi } from "vitest";
import { AuthRequiredError, AuthUnavailableError } from "@/modules/identity/domain/identity-session-errors";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
const fixture = vi.hoisted(() => ({ error: null as Error | null }));
vi.mock("@/server/composition", () => ({ applicationServices: () => ({ establishTrustedCaller: async () => { if (fixture.error) throw fixture.error; return { caller: callerFromIdentity({ id: "u", emp_id:"u",name:"Reader",org_code:"ORG" }) }; } }) }));
import { savedShareHttp } from "@/server/saved-share-http";
beforeEach(() => { fixture.error = null; vi.stubEnv("KM_PUBLIC_ORIGIN", ""); });
it("requires trusted caller and uses private caching on errors", async () => {
 for (const [error,status] of [[new AuthRequiredError(),401],[new AuthUnavailableError(),503]] as const) {
  fixture.error=error; const response=await savedShareHttp(new Request("http://hub.test/api"),async()=>({saved:true}));
  expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store");
 }
});
it("rejects missing, malformed and foreign origins before mutation", async () => {
 for (const origin of [null,"null","http://foreign.test","http://hub.test:3000"]) {
  let invoked=false; const headers = origin ? { origin } : undefined;
  const response=await savedShareHttp(new Request("http://hub.test/api",{method:"POST",headers}),async()=>{invoked=true;return {};});
  expect(response.status).toBe(403); expect(invoked).toBe(false);
 }
});
it("accepts configured public origin and returns bodyless private 204", async () => {
 vi.stubEnv("KM_PUBLIC_ORIGIN","https://public.test");
 const response=await savedShareHttp(new Request("http://bind.test/api",{method:"DELETE",headers:{origin:"https://public.test"}}),async()=>undefined,204);
 expect(response.status).toBe(204);expect(await response.text()).toBe("");expect(response.headers.get("cache-control")).toBe("private, no-store");
});
