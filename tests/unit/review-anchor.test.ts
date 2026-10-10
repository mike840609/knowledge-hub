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
