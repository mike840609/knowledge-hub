import {expect,it} from "vitest";
import {buildImportContentDiff} from "@/modules/sources/domain/import-content-diff";
const content=(markdown:string,title="Readme",metadata={owner:"one"})=>({markdown,title,metadata,contentHash:"fixture"});
it("shows context, additions and removals without changing input",()=>{
 const before=content("# Readme\r\nold\r\nsame");const after=content("# Readme\nnew\nsame");
 const diff=buildImportContentDiff(before,after);
 expect(diff.lines).toContainEqual({kind:"removed",text:"old"});expect(diff.lines).toContainEqual({kind:"added",text:"new"});
 expect(diff.lines).toContainEqual({kind:"context",text:"same"});expect(before.markdown).toContain("\r\n");expect(diff.truncated).toBe(false);
});
it("compares title and metadata independently of markdown",()=>{
 const diff=buildImportContentDiff(content("same","Old"),content("same","New",{owner:"two"}));
 expect(diff.titleChanges).toEqual({before:"Old",after:"New"});
 expect(diff.metadataChanges).toMatchObject([{key:"owner",before:'"one"',after:'"two"'}]);
 expect(diff.lines.every(line=>line.kind==="context")).toBe(true);
});
it("compares canonical nested metadata and handles new or removed content",()=>{
 expect(buildImportContentDiff(content("same","Title",{owner:"one"}),content("same","Title",{owner:"one"})).metadataChanges).toEqual([]);
 expect(buildImportContentDiff(null,content("新增內容")).lines[0]).toEqual({kind:"added",text:"新增內容"});
 expect(buildImportContentDiff(content("deleted"),null).lines[0]).toEqual({kind:"removed",text:"deleted"});
});
it("caps displayed lines, text bytes, and pathological diff work",()=>{
 const many=Array.from({length:2001},(_,i)=>`Line ${i}`).join("\n");
 const diff=buildImportContentDiff(null,content(many));expect(diff.lines.length).toBeLessThanOrEqual(2000);expect(diff.truncated).toBe(true);
 const huge=buildImportContentDiff(content("a".repeat(210000)),content("b".repeat(210000)));
 expect(huge.truncated).toBe(true);expect(new TextEncoder().encode(huge.lines.map(l=>l.text).join("")).byteLength).toBeLessThanOrEqual(200*1024);
 const pathological=buildImportContentDiff(content(Array.from({length:1000},(_,i)=>`a${i}`).join("\n")),content(Array.from({length:1000},(_,i)=>`b${i}`).join("\n")));
 expect(pathological.truncated).toBe(true);expect(pathological.lines.length).toBeLessThanOrEqual(2000);
});
