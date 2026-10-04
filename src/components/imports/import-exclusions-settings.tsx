"use client";
import {useEffect,useState} from "react";
import {readExcludedPaths,saveExcludedPaths} from "@/lib/import-exclusions";
import {Button} from "@/components/ui/button";
import {Textarea} from "@/components/ui/textarea";
export function ImportExclusionsSettings({workspaceId,sourceId,disabled}:{workspaceId:string;sourceId:string;disabled:boolean}){
  const [text,setText]=useState("");const [message,setMessage]=useState<string|null>(null);const [error,setError]=useState(false);
  useEffect(()=>{try{setText(readExcludedPaths(workspaceId,sourceId).join("\n"));}catch(e){setMessage(e instanceof Error?e.message:"Saved exclusions could not be read.");setError(true);}},[workspaceId,sourceId]);
  function save(){try{const paths=saveExcludedPaths(workspaceId,sourceId,text);setText(paths.join("\n"));setMessage("Saved on this browser. Both folder selection and Sync now use these rules.");setError(false);}catch(e){setMessage(e instanceof Error?e.message:"Could not save exclusions.");setError(true);}}
  return <details className="mt-3 rounded-md border border-kh-border p-3"><summary className="kh-focus-ring cursor-pointer rounded-md text-body">Excluded paths</summary><div className="mt-3 space-y-2">
    <label htmlFor="excluded-paths" className="block text-body">One file or folder path per line, relative to the selected folder</label>
    <Textarea id="excluded-paths" value={text} disabled={disabled} onChange={e=>{setText(e.target.value);setMessage(null);}} placeholder={"private\ntmp/cache\nsecret.md"} />
    <p className="text-caption text-kh-text-muted">.git and .obsidian directories are always excluded. Custom rules are saved per source on this browser; save before syncing.</p>
    <p className="text-caption text-kh-warning">Excluding previously synced files will archive those documents when you Apply. Review the Preview before applying.</p>
    <Button type="button" variant="secondary" disabled={disabled} onClick={save}>Save exclusions</Button>
    {message?<p role={error?"alert":undefined} className={error?"text-caption text-kh-danger":"text-caption text-kh-text-muted"}>{message}</p>:null}
  </div></details>;
}
