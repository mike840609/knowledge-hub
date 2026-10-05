import {beforeEach,it,expect,vi} from "vitest";
const state=vi.hoisted(()=>({get:vi.fn(),put:vi.fn()}));
vi.mock("@/server/workspace-http",()=>({workspaceHttp:async(work:(services:unknown,caller:unknown)=>unknown)=>work({personalPreferences:state},{identity:{id:"owner"}})}));
import {GET,PUT} from "@/app/api/workspaces/[workspaceId]/personal/freshness/route";
const context={params:Promise.resolve({workspaceId:"personal"})};
beforeEach(()=>{state.get.mockReset().mockResolvedValue({value:null,version:0});state.put.mockReset().mockResolvedValue({version:1});});
it("uses the fixed key and trusted caller for read and defaults",async()=>{
 expect(await GET(new Request("http://local?key=prefs:other"),context)).toEqual({thresholdDays:30,version:0});
 expect(state.get).toHaveBeenCalledWith({identity:{id:"owner"}},"personal","prefs:freshness");
});
it("authorizes before validation and propagates ownership denial",async()=>{
 state.get.mockRejectedValue(new Error("not owner"));
 await expect(PUT(new Request("http://local",{method:"PUT",body:"{}"}),context)).rejects.toThrow("not owner");expect(state.put).not.toHaveBeenCalled();
});
it("rejects invalid schema without writing",async()=>{
 await expect(PUT(new Request("http://local",{method:"PUT",body:JSON.stringify({value:{thresholdDays:8},version:0})}),context)).rejects.toThrow("Choose a freshness threshold");expect(state.put).not.toHaveBeenCalled();
});
it("passes CAS version to owner-only service and propagates conflict",async()=>{
 state.put.mockRejectedValue(new Error("conflict"));
 await expect(PUT(new Request("http://local",{method:"PUT",body:JSON.stringify({value:{thresholdDays:30},version:2,key:"prefs:other"})}),context)).rejects.toThrow("conflict");
 expect(state.put).toHaveBeenCalledWith({identity:{id:"owner"}},"personal","prefs:freshness",{thresholdDays:30},2);
});
