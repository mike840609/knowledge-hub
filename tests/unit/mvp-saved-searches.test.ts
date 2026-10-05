import { describe, expect, it } from "vitest";
import { savedSearchHref, validateSavedSearches } from "@/lib/saved-searches";
const filters = { q: "knowledge & safety", scope: "workspace", source: "", path: "docs/runbooks", from: "2026-01-01", to: "2026-01-31", offset: "480", sort: "newest", archived: true } as const;
const item = { id: "stable-1", name: "My view", filters };
describe("saved search payload and local navigation", () => {
 it("round trips allowlisted filters and resets pagination", () => {
  expect(validateSavedSearches({searches:[item]}).searches[0]).toEqual(item);
  const url = new URL(savedSearchHref("personal", filters), "http://localhost");
  expect(url.pathname).toBe("/w/personal/search");expect(url.searchParams.get("q")).toBe(filters.q); expect(url.searchParams.has("page")).toBe(false);expect(url.searchParams.get("archived")).toBe("1");
 });
 it.each([{...item, name:""},{...item,name:"x".repeat(81)}, {...item, filters:{...filters,href:"https://evil.test"}}, {...item,filters:{...filters,path:"../private"}}, {...item,filters:{...filters,from:"2026-02-30"}}, {...item,filters:{...filters,sort:"unsafe"}}, {...item,filters:{...filters,offset:"841"}}, {...item,filters:{...filters,scope:"all",source:"another-source"}}, {...item,filters:{...filters,archived:"1"}}, {...item,filters:{...filters,q:"x".repeat(201)}}])("rejects malformed feature data", value => expect(()=>validateSavedSearches({searches:[value]})).toThrow());
 it("rejects duplicate ids, excess views and unknown payload keys",()=>{
  expect(()=>validateSavedSearches({searches:[item,item]})).toThrow();expect(()=>validateSavedSearches({searches:Array.from({length:21},(_,i)=>({...item,id:`id-${i}`}))})).toThrow();expect(()=>validateSavedSearches({searches:[],key:"other"})).toThrow();
 });
});
