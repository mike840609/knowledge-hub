/** Browser-local source preferences, not an authorization mechanism. Rules are exact root-relative paths or directory prefixes. */
export function parseExcludedPaths(text: string): string[] {
  const rules=[...new Set(text.split(/\r?\n/).map(line=>line.trim().replace(/\\/g,"/").replace(/\/+$/,"")).filter(Boolean))];
  if(rules.length>50) throw new Error("Use at most 50 excluded paths.");
  for(const rule of rules) if(rule.length>1024 || rule.startsWith("/") || rule.split("/").some(part=>!part||part==="."||part==="..") || /[*?\[\]:\u0000-\u001f]/.test(rule)) throw new Error("Use relative file or folder paths, without wildcards or .. segments.");
  return rules;
}
export function isExcludedImportPath(path: string, rules: readonly string[]): boolean {
  if(path.split("/").some(part=>part===".git"||part===".obsidian"))return true;
  return rules.some(rule=>path===rule||path.startsWith(`${rule}/`));
}
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
