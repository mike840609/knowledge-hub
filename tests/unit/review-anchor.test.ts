import * as markdownParser from "@/shared/markdown/parse";
import { describe,expect,it,vi } from "vitest";
import { createReviewAnchorRelocator,projectReviewBlocks,validateReviewAnchor,relocateReviewAnchor } from "@/modules/knowledge/domain/review-anchor";
const anchor={schemaVersion:1 as const,blockPath:[0],blockKind:"paragraph" as const,startUtf16:0,endUtf16:2,exact:"😀",prefix:"",suffix:" hello"};
describe("canonical review anchors",()=>{
 it("uses UTF16 and concatenates formatting",()=>{expect(projectReviewBlocks("😀 **hello**")[0].text).toBe("😀 hello");expect(validateReviewAnchor("😀 **hello**",anchor)).toEqual(anchor);});
 it("refuses wikilinks and relative links for whole block",()=>{for(const markdown of ["safe [[Wiki]]", "safe [doc](./file.md)","safe ![img](https://a/img)"]){expect(projectReviewBlocks(markdown)[0].selectable).toBe(false);}});
 it("never guesses between repeated quotes",()=>{expect(relocateReviewAnchor("😀 hello\n\n😀 hello",anchor,false)).toEqual({match:"OUTDATED"});});
});
it("rejects offset and context forgery including surrogate splits",()=>{
 for(const changed of [{endUtf16:1,exact:"\ud83d",suffix:"\ude00 hello"},{prefix:"forged"},{startUtf16:-1},{blockPath:[999]},{blockKind:"heading" as const}])expect(()=>validateReviewAnchor("😀 hello",{...anchor,...changed})).toThrow();
});
it("normalizes whitespace deterministically and refuses complex/hard-break blocks",()=>{
 expect(projectReviewBlocks("a\r\nb **c** `d`")[0].text).toBe("a b c d");
 for(const markdown of ["a  \nb","a <span>x</span>","a [ref][a]\n\n[a]: ./file.md"]){expect(projectReviewBlocks(markdown)[0].selectable).toBe(false);}
});
it("relocates a unique current quote and strips stale anchors on mismatch",()=>{
 expect(relocateReviewAnchor("# New heading\n\n😀 hello",anchor,false)).toMatchObject({match:"MOVED",anchor:{blockPath:[1]}});
 expect(relocateReviewAnchor("Changed",anchor,true)).toEqual({match:"OUTDATED"});
 expect(relocateReviewAnchor("x".repeat(1_000_001),anchor,false)).toEqual({match:"OUTDATED"});
});
it("caps Unicode exact and context lengths",()=>{
 expect(()=>validateReviewAnchor("a".repeat(513),{...anchor,endUtf16:513,exact:"a".repeat(513),suffix:""})).toThrow();
 expect(()=>validateReviewAnchor("a",{...anchor,endUtf16:1,exact:"a",prefix:"x".repeat(65),suffix:""})).toThrow();
});
it("refuses distant semantic neighborhoods instead of attaching a surviving quote",()=>{
 expect(relocateReviewAnchor(Array.from({length:12},(_,i)=>`Unrelated section ${i}`).join("\n\n")+"\n\n😀 hello",anchor,false)).toEqual({match:"OUTDATED"});
});
it("rejects clamped out-of-bounds ranges and strips arbitrary JSON metadata",()=>{
 expect(()=>validateReviewAnchor("😀 hello",{...anchor,endUtf16:999,exact:"😀 hello",suffix:""})).toThrow();
 const injected={...anchor,token:"secret-token",body:"secret-body"};
 expect(validateReviewAnchor("😀 hello",injected)).toEqual(anchor);
 expect(relocateReviewAnchor("# Header\n\n😀 hello",injected,false)).toEqual({match:"MOVED",anchor:{...anchor,blockPath:[1]}});
});

it("parses once per discussion projection and isolates different revisions",()=>{
 const parse=vi.spyOn(markdownParser,"parseMarkdown");
 try {
  const relocate=createReviewAnchorRelocator("😀 hello");
  expect(parse).not.toHaveBeenCalled();
  for(let i=0;i<200;i++) expect(relocate(anchor,i%2===0)).toMatchObject({match:i%2===0?"MATCHED":"MOVED"});
  expect(parse).toHaveBeenCalledTimes(1);
  expect(createReviewAnchorRelocator("Changed")(anchor,true)).toEqual({match:"OUTDATED"});
  expect(parse).toHaveBeenCalledTimes(2);
 } finally { parse.mockRestore(); }
});

describe("a passage in a table cell or a code block",()=>{
 const table="| Name | Role |\n|---|---|\n| Ada | **Owner** here |";
 const cell={schemaVersion:1 as const,blockPath:[0,1,1],blockKind:"tableCell" as const,startUtf16:0,endUtf16:5,exact:"Owner",prefix:"",suffix:" here"};
 const fenced="```\nif (a) {\n    b();\n}\n```";
 const code={schemaVersion:1 as const,blockPath:[0],blockKind:"code" as const,startUtf16:7,endUtf16:17,exact:"{\n    b();",prefix:"if (a) ",suffix:"\n}"};
 it("a cell is its own block, read as a paragraph is",()=>{
  const cells=projectReviewBlocks(table).filter(block=>block.kind==="tableCell");
  expect(cells.map(block=>[block.path,block.text,block.selectable])).toEqual([[[0,0,0],"Name",true],[[0,0,1],"Role",true],[[0,1,0],"Ada",true],[[0,1,1],"Owner here",true]]);
  expect(validateReviewAnchor(table,cell)).toEqual(cell);
 });
 it("a cell that holds what a paragraph may not is refused as the paragraph would be",()=>{
  for(const markdown of ["| a |\n|---|\n| one<br>two |","| a |\n|---|\n| see [[Wiki]] |","| a |\n|---|\n| ![x](https://a/img) |"]) expect(projectReviewBlocks(markdown).filter(block=>block.kind==="tableCell").at(-1)!.selectable).toBe(false);
 });
 it("code is read as it was written: its line breaks and its spaces are its text",()=>{
  expect(projectReviewBlocks(fenced)[0]).toMatchObject({kind:"code",text:"if (a) {\n    b();\n}",selectable:true});
  expect(validateReviewAnchor(fenced,code)).toEqual(code);
  // Counted as a paragraph's would be — whitespace run together — it is another passage, and refused.
  expect(()=>validateReviewAnchor(fenced,{...code,endUtf16:14,exact:"{ b();"})).toThrow();
 });
 it("what looks like a link inside code is code",()=>{expect(projectReviewBlocks("```\nsee [[Wiki]] and ![x](y)\n```")[0].selectable).toBe(true);});
 it("neither is taken for the other, nor for a paragraph",()=>{
  expect(()=>validateReviewAnchor(table,{...cell,blockKind:"paragraph"})).toThrow();
  expect(()=>validateReviewAnchor(fenced,{...code,blockKind:"paragraph"})).toThrow();
  expect(()=>validateReviewAnchor("{\n    b();",{...code,startUtf16:0,endUtf16:1,exact:"{",prefix:"",suffix:" b();"})).toThrow();
 });
 it("both are found again after the document changes around them, and not in another row",()=>{
  expect(relocateReviewAnchor(`# Added\n\n${table}`,cell,false)).toMatchObject({match:"MOVED",anchor:{blockPath:[1,1,1]}});
  expect(relocateReviewAnchor("| Name | Role |\n|---|---|\n| New | row |\n| Ada | **Owner** here |",cell,false)).toEqual({match:"OUTDATED"});
  expect(relocateReviewAnchor(`Added\n\n${fenced}`,code,false)).toMatchObject({match:"MOVED",anchor:{blockPath:[1],startUtf16:7}});
  expect(relocateReviewAnchor("```\nif (a) {\n  b();\n}\n```",code,false)).toEqual({match:"OUTDATED"});
 });
});
