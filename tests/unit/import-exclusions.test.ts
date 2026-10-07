import {expect,it} from "vitest";
import {parseExcludedPaths,isExcludedImportPath,isIgnoredImportPath} from "@/lib/import-exclusions";
it("excludes repository and Obsidian internals at any depth, without excluding similarly named notes",()=>{
  expect(isExcludedImportPath("nested/.git/config",[])).toBe(true);expect(isExcludedImportPath(".obsidian/workspace.json",[])).toBe(true);expect(isExcludedImportPath("git-guide.md",[])).toBe(false);
});
it.each(["node_modules/pkg/README.md","docs/node_modules/x.png",".trash/deleted.md","notes/.github/workflow.md",".DS_Store","img/Thumbs.db"])("always skips %s, like .git and .obsidian",path=>{
  expect(isExcludedImportPath(path,[])).toBe(true);expect(isIgnoredImportPath(path)).toBe(true);
});
it.each(["v1.2/notes.md","my.notes.md","node_modules-guide.md","docs/Thumbs.db.md"])("keeps %s, whose dots and names only resemble an ignored path",path=>{
  expect(isExcludedImportPath(path,[])).toBe(false);
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
  vi.stubGlobal("fetch",vi.fn(async(url:string,init:RequestInit)=>{if (url.endsWith("import-scope")) return Response.json({ paths: ["private"], configured: true, syncVersion: 1 });requests.push({url,init});return Response.json(url.endsWith("source-imports")?{snapshotId:"snap"}:{});}));
  await runFolderImport({target:{kind:"existing",workspaceId:"ws",sourceId:"source",sourceName:"Wiki"},files:[file("private/secret.md"),file("public/guide.md")],sourceName:"",onProgress:()=>{}});
  const manifest=JSON.parse(String(requests[0].init.body)).manifest;
  expect(manifest.map((e:{relativePath:string})=>e.relativePath)).toEqual(["public/guide.md"]);
  const form=requests[1].init.body as FormData;expect(JSON.parse(String(form.get("entries")))).toHaveLength(1);
});
it("drops node_modules and hidden folders before reading, hashing, counting or uploading them",async()=>{
  const requests: {url:string;init:RequestInit}[]=[];
  vi.stubGlobal("fetch",vi.fn(async(url:string,init:RequestInit)=>{requests.push({url,init});return Response.json(url.endsWith("source-imports")?{snapshotId:"snap"}:{});}));
  // An ignored asset must never be read: reading it is the cost the fix removes.
  const ignoredAsset=new File(["binary"],"logo.png");Object.defineProperty(ignoredAsset,"webkitRelativePath",{value:"wiki/node_modules/pkg/logo.png"});
  Object.defineProperty(ignoredAsset,"arrayBuffer",{value:()=>{throw new Error("ignored asset was read");}});
  await runFolderImport({target:{kind:"new",workspaceId:"ws"},files:[file("node_modules/pkg/README.md"),ignoredAsset,file(".trash/old.md"),file("notes/keep.md")],sourceName:"Wiki",onProgress:()=>{}});
  const create=JSON.parse(String(requests[0].init.body));
  expect(create.manifest.map((e:{relativePath:string})=>e.relativePath)).toEqual(["notes/keep.md"]);
  const uploads=requests.filter(r=>r.url.endsWith("/entries"));
  expect(uploads).toHaveLength(1);expect(JSON.parse(String((uploads[0].init.body as FormData).get("entries")))).toHaveLength(1);
});
it("reports only the files the source's own rules excluded, not the ignored ones",async()=>{
  const requests: {url:string;init:RequestInit}[]=[];
  vi.stubGlobal("fetch",vi.fn(async(url:string,init:RequestInit)=>{requests.push({url,init});return Response.json(url.endsWith("source-imports")?{snapshotId:"snap"}:{});}));
  // The fallback input lists ignored files; the count must not depend on which browser listed them.
  await runFolderImport({target:{kind:"new",workspaceId:"ws"},files:[file("node_modules/a/README.md"),file(".trash/old.md"),file("private/secret.md"),file("notes/keep.md")],sourceName:"Wiki",excludedPaths:["private"],onProgress:()=>{}});
  expect(JSON.parse(String(requests[0].init.body)).importScope).toEqual({paths:["private"],excludedCount:1});
});
it("refuses a folder whose only files are ignored, before contacting the server",async()=>{
  const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
  await expect(runFolderImport({target:{kind:"new",workspaceId:"ws"},files:[file("node_modules/a/README.md"),file(".git/HEAD.md")],sourceName:"Wiki",onProgress:()=>{}})).rejects.toMatchObject({code:"INVALID_IMPORT_MANIFEST"});
  expect(fetch).not.toHaveBeenCalled();
});
it("keeps invalid legacy preferences from blocking authoritative source rules",async()=>{
  vi.stubGlobal("localStorage",{getItem:()=>"../private"});
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({ paths: [], configured: false, syncVersion: 1 })));
  const {loadSourceImportScope}=await import("@/lib/source-import-scope");
  expect(await loadSourceImportScope("ws","source")).toMatchObject({paths:[],configured:false});
});
