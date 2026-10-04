export { parseExcludedPaths, isExcludedImportPath } from "@/modules/sources/domain/import-scope";
import { parseExcludedPaths } from "@/modules/sources/domain/import-scope";

function key(workspaceId:string,sourceId:string){return `km:import-exclusions:${workspaceId}:${sourceId}`;}
export function readExcludedPaths(workspaceId:string,sourceId:string):string[]{
  try {return parseExcludedPaths(globalThis.localStorage?.getItem(key(workspaceId,sourceId))??"");}
  catch {throw new Error("Saved exclusions could not be read. Open Update from folder and save valid exclusion settings before syncing.");}
}
export function saveExcludedPaths(workspaceId:string,sourceId:string,text:string):string[]{
  const rules=parseExcludedPaths(text);
  if(!globalThis.localStorage) throw new Error("Browser storage is unavailable; exclusion settings were not saved.");
  globalThis.localStorage.setItem(key(workspaceId,sourceId),rules.join("\n"));return rules;
}
