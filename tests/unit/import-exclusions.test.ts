import {expect,it} from "vitest";
import {parseExcludedPaths,isExcludedImportPath} from "@/lib/import-exclusions";
it("excludes repository and Obsidian internals at any depth, without excluding similarly named notes",()=>{
  expect(isExcludedImportPath("nested/.git/config",[])).toBe(true);expect(isExcludedImportPath(".obsidian/workspace.json",[])).toBe(true);expect(isExcludedImportPath("git-guide.md",[])).toBe(false);
});
it("matches custom root-relative files and directory prefixes at segment boundaries",()=>{
  const rules=parseExcludedPaths("private/\n tmp\\cache \nprivate\nsecret.md");expect(rules).toEqual(["private","tmp/cache","secret.md"]);
  expect(isExcludedImportPath("private/note.md",rules)).toBe(true);expect(isExcludedImportPath("private-notes.md",rules)).toBe(false);expect(isExcludedImportPath("public/private/note.md",rules)).toBe(false);
});
it.each(["../secret","/private","private/*","a/../b"])("rejects ambiguous rule %s",rule=>expect(()=>parseExcludedPaths(rule)).toThrow());

import {runFolderImport} from "@/components/imports/folder-import-form";
import {vi,afterEach} from "vitest";
afterEach(()=>vi.unstubAllGlobals());
function file(path:string){const f=new File(["# A\nbody"],path.split("/").at(-1)!);Object.defineProperty(f,"webkitRelativePath",{value:`wiki/${path}`});return f;}
it("does not create a destructive empty snapshot when all selected files are excluded",async()=>{
  const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
  await expect(runFolderImport({target:{kind:"new",workspaceId:"ws"},files:[file(".obsidian/config.md")],sourceName:"Wiki",onProgress:()=>{}})).rejects.toMatchObject({code:"INVALID_IMPORT_MANIFEST"});
  expect(fetch).not.toHaveBeenCalled();
});
it("filters saved source-relative prefixes before manifest creation and upload",async()=>{
  vi.stubGlobal("localStorage",{getItem:()=>"private"});
  const requests: {url:string;init:RequestInit}[]=[];
  vi.stubGlobal("fetch",vi.fn(async(url:string,init:RequestInit)=>{requests.push({url,init});return Response.json(url.endsWith("source-imports")?{snapshotId:"snap"}:{});}));
  await runFolderImport({target:{kind:"existing",workspaceId:"ws",sourceId:"source",sourceName:"Wiki"},files:[file("private/secret.md"),file("public/guide.md")],sourceName:"",onProgress:()=>{}});
  const manifest=JSON.parse(String(requests[0].init.body)).manifest;
  expect(manifest.map((e:{relativePath:string})=>e.relativePath)).toEqual(["public/guide.md"]);
  const form=requests[1].init.body as FormData;expect(JSON.parse(String(form.get("entries")))).toHaveLength(1);
});
it("refuses sync when saved rules are corrupt instead of uploading files without the intended exclusions",async()=>{
  vi.stubGlobal("localStorage",{getItem:()=>"../private"});const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
  await expect(runFolderImport({target:{kind:"existing",workspaceId:"ws",sourceId:"source",sourceName:"Wiki"},files:[file("private/secret.md")],sourceName:"",onProgress:()=>{}})).rejects.toThrow("Saved exclusions could not be read");expect(fetch).not.toHaveBeenCalled();
});
