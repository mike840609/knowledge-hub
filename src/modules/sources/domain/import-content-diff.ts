import type {RevisionPayload} from "./import-plan";
import {canonicalizeJsonObject} from "@/modules/knowledge/domain/content";
export type ImportContentDiff = {
 titleChanges:{before:string|null;after:string|null}|null;
 metadataChanges:{key:string;before:string|null;after:string|null}[];
 lines:{kind:"context"|"added"|"removed";text:string}[];
 truncated:boolean;
};
export type ImportPreviewContentDiff=ImportContentDiff & {snapshotId:string;basedOnVersion:number|null;beforeRevisionId:string|null;afterUploadKey:string|null;beforePath:string|null;afterPath:string};
const MAX_LINES=2000,MAX_BYTES=200*1024,MAX_CELLS=250000;
export function buildImportContentDiff(before:RevisionPayload|null,after:RevisionPayload|null):ImportContentDiff{
 const result:ImportContentDiff={titleChanges:null,metadataChanges:[],lines:[],truncated:false};
 const encoder=new TextEncoder();let remaining=MAX_BYTES;
 function take(text:string):string{
  const bytes=encoder.encode(text);if(bytes.length<=remaining){remaining-=bytes.length;return text;}
  result.truncated=true;let end=remaining;
  while(end>0){try{const value=new TextDecoder("utf-8",{fatal:true}).decode(bytes.subarray(0,end));remaining-=end;return value;}catch{end--;}}
  remaining=0;return "";
 }
 if(before?.title!==after?.title)result.titleChanges={before:before?take(before.title):null,after:after?take(after.title):null};
 const oldMeta=before?canonicalizeJsonObject(before.metadata):{},newMeta=after?canonicalizeJsonObject(after.metadata):{};
 for(const key of [...new Set([...Object.keys(oldMeta),...Object.keys(newMeta)])].sort()){
  const a=oldMeta[key]===undefined?null:JSON.stringify(oldMeta[key]);const b=newMeta[key]===undefined?null:JSON.stringify(newMeta[key]);
  if(a===b)continue;if(!remaining){result.truncated=true;break;}
  result.metadataChanges.push({key:take(key),before:a===null?null:take(a),after:b===null?null:take(b)});
 }
 function split(text:string|undefined):string[]{
  if(text===undefined)return [];
  const normalized=text.replace(/\r\n?/g,"\n");
  if(normalized.length>MAX_BYTES)result.truncated=true;
  const lines=normalized.slice(0,MAX_BYTES).split("\n",MAX_LINES+1);
  if(lines.length>MAX_LINES)result.truncated=true;
  return lines.slice(0,MAX_LINES);
 }
 const a=split(before?.markdown),b=split(after?.markdown);
 function push(kind:ImportContentDiff["lines"][number]["kind"],text:string){
  if(result.lines.length>=MAX_LINES||remaining===0){result.truncated=true;return;}
  result.lines.push({kind,text:take(text)});
 }
 let prefix=0;while(prefix<a.length&&prefix<b.length&&a[prefix]===b[prefix]){push("context",a[prefix]);prefix++;}
 let suffix=0;while(suffix<a.length-prefix&&suffix<b.length-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;
 const left=a.slice(prefix,a.length-suffix),right=b.slice(prefix,b.length-suffix);
 if((left.length+1)*(right.length+1)>MAX_CELLS){
  result.truncated=true;left.forEach(text=>push("removed",text));right.forEach(text=>push("added",text));
 }else{
  const width=right.length+1,table=new Uint32Array((left.length+1)*width);
  for(let i=left.length-1;i>=0;i--)for(let j=right.length-1;j>=0;j--)table[i*width+j]=left[i]===right[j]?1+table[(i+1)*width+j+1]:Math.max(table[(i+1)*width+j],table[i*width+j+1]);
  let i=0,j=0;while(i<left.length||j<right.length){
   if(i<left.length&&j<right.length&&left[i]===right[j]){push("context",left[i++]);j++;}
   else if(i<left.length&&(j===right.length||table[(i+1)*width+j]>=table[i*width+j+1]))push("removed",left[i++]);
   else push("added",right[j++]);
  }
 }
 for(let i=a.length-suffix;i<a.length;i++)push("context",a[i]);
 return result;
}
