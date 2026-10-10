import type { Nodes } from "mdast";
import { parseMarkdown } from "@/shared/markdown/parse";
import { ValidationError } from "./errors";
import { copyReviewAnchor, REVIEW_LIMITS, type ReviewAnchor, type CurrentAnchorProjection } from "./document-review";
export type CanonicalReviewBlock = { path:number[]; kind:ReviewAnchor["blockKind"]; text:string; selectable:boolean };
const kinds = new Set(["heading","paragraph","listItem","blockquote"]);
const inlineKinds = new Set(["text","inlineCode","emphasis","strong","delete","link","linkReference","break"]);
// Paths are child indexes from the mdast root. Text is inline reading order,
// CRLF normalized to LF, with soft line breaks/whitespace collapsed to one space.
// Offsets are JavaScript UTF-16 offsets; quote/context caps count code points.
function textOf(node:Nodes):string {
  if(node.type==="break") return "\n";
  if("value" in node) return typeof node.value==="string"?node.value:"";
  if("children" in node) return node.children.map(n=>textOf(n as Nodes)).join("");
  return "";
}
function safeInline(node:Nodes):boolean {
  if(!inlineKinds.has(node.type) || node.type === "break") return false;
  if(node.type==="link" && !/^(?:https?:|mailto:|tel:|#)/i.test(node.url)) return false;
  // Reference destinations depend on separate nodes; conservatively refuse.
  if(node.type==="linkReference") return false;
  return !("children" in node) || node.children.every(n=>safeInline(n as Nodes));
}
export function projectReviewBlocks(markdown:string):CanonicalReviewBlock[] {
 const result:CanonicalReviewBlock[]=[];
 function walk(node:Nodes,path:number[]) {
   if(kinds.has(node.type)) {
     const text=textOf(node).replace(/\r\n?/g,"\n").replace(/[\t\n\r ]+/g," ");
     // Container blocks are deliberately unselectable: their nested leaf blocks
     // receive paths separately, preventing overlapping DOM anchor candidates.
     const selectable=(node.type==="heading"||node.type==="paragraph") && "children" in node && node.children.every(n=>safeInline(n as Nodes)) && !/\[\[/.test(text);
     result.push({path,kind:node.type as ReviewAnchor["blockKind"],text,selectable});
   }
   if("children" in node) node.children.forEach((n,i)=>walk(n as Nodes,[...path,i]));
 }
 walk(parseMarkdown(markdown),[]);return result;
}
function contexts(text:string,start:number,end:number) {
 return {prefix:[...text.slice(0,start)].slice(-REVIEW_LIMITS.context).join(""),suffix:[...text.slice(end)].slice(0,REVIEW_LIMITS.context).join("")};
}
function validShape(anchor:ReviewAnchor):boolean {
 return !!anchor && anchor.schemaVersion===1 && Array.isArray(anchor.blockPath) && anchor.blockPath.length>0 && anchor.blockPath.length<=64 && anchor.blockPath.every(n=>Number.isSafeInteger(n)&&n>=0) && typeof anchor.exact==="string" && [...anchor.exact].length>0 && [...anchor.exact].length<=REVIEW_LIMITS.quote && typeof anchor.prefix==="string" && [...anchor.prefix].length<=REVIEW_LIMITS.context && typeof anchor.suffix==="string" && [...anchor.suffix].length<=REVIEW_LIMITS.context && Number.isSafeInteger(anchor.startUtf16)&&Number.isSafeInteger(anchor.endUtf16)&&anchor.startUtf16>=0&&anchor.endUtf16>anchor.startUtf16;
}
export function validateReviewAnchor(markdown:string,anchor:ReviewAnchor):ReviewAnchor {
 if(!validShape(anchor)) throw new ValidationError("Invalid review anchor.");
 return validateAnchorInBlocks(projectReviewBlocks(markdown),anchor);
}
function validateAnchorInBlocks(blocks:CanonicalReviewBlock[],anchor:ReviewAnchor):ReviewAnchor {
 if(!validShape(anchor)) throw new ValidationError("Invalid review anchor.");
 const block=blocks.find(b=>JSON.stringify(b.path)===JSON.stringify(anchor.blockPath));
 if(!block?.selectable || block.kind!==anchor.blockKind || anchor.endUtf16>block.text.length || block.text.slice(anchor.startUtf16,anchor.endUtf16)!==anchor.exact) throw new ValidationError("Selection does not match current document.");
 const context=contexts(block.text,anchor.startUtf16,anchor.endUtf16);
 if(context.prefix!==anchor.prefix||context.suffix!==anchor.suffix) throw new ValidationError("Selection context does not match current document.");
 // Reject offsets through half of a surrogate pair.
 for(const offset of [anchor.startUtf16,anchor.endUtf16]) if(offset>0&&/[\uD800-\uDBFF]/.test(block.text[offset-1])&&/[\uDC00-\uDFFF]/.test(block.text[offset]??"")) throw new ValidationError("Selection splits a Unicode character.");
 return copyReviewAnchor(anchor);
}
export function relocateReviewAnchor(markdown:string,original:ReviewAnchor,sameRevision:boolean):CurrentAnchorProjection {
 return createReviewAnchorRelocator(markdown)(original,sameRevision);
}
// Request-scoped lazy projection: parse once, with no cross-request revision cache.
export function createReviewAnchorRelocator(markdown:string) {
 let projected:CanonicalReviewBlock[]|undefined;
 return (original:ReviewAnchor,sameRevision:boolean):CurrentAnchorProjection => {
 if(!validShape(original)||markdown.length>1_000_000) return {match:"OUTDATED"};
 const blocks=projected??(projected=projectReviewBlocks(markdown));
 if(sameRevision) {try {return {match:"MATCHED",anchor:validateAnchorInBlocks(blocks,original)};} catch {return {match:"OUTDATED"};}}
 if(blocks.length>2000) return {match:"OUTDATED"};
 const candidates:ReviewAnchor[]=[];
 for(const block of blocks) {
   if(!block.selectable||block.kind!==original.blockKind) continue;
   // Relocate only within the original structural neighborhood. A quote that
   // disappeared here and happens to survive in a distant section is unsafe.
   if(Math.abs(block.path[0]-original.blockPath[0])>8 || block.path.length!==original.blockPath.length || block.path.slice(1,-1).some((part,i)=>part!==original.blockPath[i+1])) continue;
   let pos=block.text.indexOf(original.exact);
   while(pos>=0) {
     const end=pos+original.exact.length,context=contexts(block.text,pos,end);
     if(context.prefix===original.prefix&&context.suffix===original.suffix) candidates.push({...copyReviewAnchor(original),blockPath:block.path,startUtf16:pos,endUtf16:end,...context});
     if(candidates.length>1) return {match:"OUTDATED"};
     pos=block.text.indexOf(original.exact,pos+1);
   }
 }
 return candidates.length===1?{match:"MOVED",anchor:candidates[0]}:{match:"OUTDATED"};
 };
}
