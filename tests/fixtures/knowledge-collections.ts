import type { Pool } from "mariadb";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { uuidv7 } from "@/shared/ids/uuidv7";

export async function collectionFixture(pool:Pool) {
  const userId=uuidv7(),uow=new MariaDbUnitOfWork(pool);
  const caller=callerFromIdentity({id:userId,emp_id:`COLLECT-${userId}`,name:"Collection writer",org_code:"COLLECT"});
  await uow.run(r=>r.users.upsertIdentity(caller.identity));
  const {workspace}=await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(userId);
  const sourceId=await ensureDefaultHubSource(uow,caller,workspace.id);
  const hub=new HubKnowledgeCommandServiceImpl(uow);
  const d1=await hub.createDocument(caller,{sourceId,parentId:null,title:"Overview",markdown:"First content",metadata:{}});
  const d2=await hub.createDocument(caller,{sourceId,parentId:null,title:"Architecture",markdown:"Second content",metadata:{}});
  return {uow,caller,workspace,sourceId,hub,d1,d2};
}
