import { applicationServices } from "./composition";
export async function markDocumentRead(input:{workspaceId:string;documentId:string;revisionId:string}):Promise<void>{
  const s=applicationServices();const {caller}=await s.establishTrustedCaller();
  await s.documentReadProgress.markRead(caller,input);
}
