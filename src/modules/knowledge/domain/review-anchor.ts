import type { Nodes } from "mdast";
import { parseMarkdown } from "@/shared/markdown/parse";
import { replaceWikiLinks, shownText } from "./replace-wiki-links";
import { calloutMarker } from "@/shared/markdown/remark-callouts";
import { htmlAsText, isCommentHtml, isLineBreakHtml } from "@/shared/markdown/remark-known-html";
import { ValidationError } from "./errors";
import { copyReviewAnchor, REVIEW_LIMITS, type ReviewAnchor, type CurrentAnchorProjection } from "./document-review";
export type CanonicalReviewBlock = { path:number[]; kind:ReviewAnchor["blockKind"]; text:string; selectable:boolean;
  /** How much of the start of `text` the reader does not show: a callout's marker. No passage reaches into it. */
  hidden:number };
const kinds = new Set(["heading","paragraph","listItem","blockquote","tableCell","code"]);
// What a passage can be chosen in: a block that holds text and no other block.
const leaves = new Set(["heading","paragraph","tableCell"]);
// An image, inline or by reference, and a footnote reference hold no text the reader shows as
// theirs (its label, the number, are left out on the page too); HTML is read as the reader draws
// it (§3c).
const inlineKinds = new Set(["text","inlineCode","emphasis","strong","delete","link","linkReference","break","image","imageReference","footnoteReference","html"]);
// Paths are child indexes from the mdast root. Text is inline reading order,
// CRLF normalized to LF, with line breaks — soft or hard — and whitespace collapsed
// to one space. A `[[wikilink]]` is the text shown for it, which is what a reader
// selects; how it is written is not on the page.
// A fenced or indented code block is the exception: its text is its code as
// written, since there a line break and a run of spaces are what was written.
// Offsets are JavaScript UTF-16 offsets; quote/context caps count code points.
function textOf(node:Nodes):string {
  if(node.type==="break") return "\n";
  if(node.type==="html") return htmlAsText(node.value);
  if("value" in node) return typeof node.value==="string"?node.value:"";
  if("children" in node) return node.children.map(n=>textOf(n as Nodes)).join("");
  return "";
}
function safeInline(node:Nodes):boolean {
  if(!inlineKinds.has(node.type)) return false;
  // A reference link's words depend on a separate definition; conservatively refuse.
  if(node.type==="linkReference") return false;
  // `<br>` and comments only: the inline tags the reader draws pair up by rules this does not share.
  if(node.type==="html" && !isLineBreakHtml(node.value) && !isCommentHtml(node.value)) return false;
  return !("children" in node) || node.children.every(n=>safeInline(n as Nodes));
}
export function projectReviewBlocks(markdown:string):CanonicalReviewBlock[] {
 const result:CanonicalReviewBlock[]=[];
 function walk(node:Nodes,path:number[],hidden=0) {
   if(kinds.has(node.type)) {
     const code=node.type==="code";
     // The page drops the gap a non-code block opens with (`fromStart` in review-selection.ts), and
     // so does this: an image, `<br>` or footnote number, a hard break, an encoded space or tab, or
     // inline code opening with a space would otherwise lead the text with one.
     const text=code?node.value:textOf(node).replace(/\r\n?/g,"\n").replace(/[\t\n\r ]+/g," ").replace(/^ /,"");
     // Container blocks are deliberately unselectable: their nested leaf blocks
     // receive paths separately, preventing overlapping DOM anchor candidates.
     // A leaf with no text (an image alone) has nothing to quote.
     const selectable=code || (leaves.has(node.type) && text!=="" && "children" in node && node.children.every(n=>safeInline(n as Nodes)));
     result.push({path,kind:node.type as ReviewAnchor["blockKind"],text,selectable,hidden});
   }
   // A callout's marker is in its opening paragraph's text and not on the page; the marker's line
   // break is, like any other, one space of that text.
   const marker=node.type==="blockquote"?calloutMarker(node)?.text.replace(/[\t\n\r ]+/g," ").length??0:0;
   if("children" in node) node.children.forEach((n,i)=>walk(n as Nodes,[...path,i],i===0?marker:0));
 }
 const tree=parseMarkdown(markdown);
 replaceWikiLinks(tree,markdown,match=>({type:"text",value:shownText(match)}));
 walk(tree,[]);return result;
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
 if(!block?.selectable || block.kind!==anchor.blockKind || anchor.startUtf16<block.hidden || anchor.endUtf16>block.text.length || block.text.slice(anchor.startUtf16,anchor.endUtf16)!==anchor.exact) throw new ValidationError("Selection does not match current document.");
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
   let pos=block.text.indexOf(original.exact,block.hidden);
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
