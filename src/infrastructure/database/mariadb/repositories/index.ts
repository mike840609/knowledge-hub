import type { DatabaseConnection } from "../pool";
import { MariaDbUserRepository } from "./users";
import { MariaDbSourceRepository } from "./sources";
import { MariaDbSourcePolicyRepository } from "./source-policy";
import { MariaDbDocumentRepository } from "./documents";
import { MariaDbRevisionRepository } from "./revisions";
import { MariaDbTreeRepository } from "./tree";
import { MariaDbEntryRepository } from "./entries";
import { MariaDbAssetRepository } from "./assets";
import { MariaDbSyncRunRepository } from "./sync-runs";
import { MariaDbWorkspaceRepository } from "./workspaces";
import { MariaDbWorkspaceMembershipRepository } from "./workspace-memberships";
import { WorkspaceMembershipPolicy } from "@/modules/workspaces/application/workspace-query-service";
import type { SourceRepositories } from "@/modules/sources/ports/unit-of-work";

export function createRepositories(connection: DatabaseConnection): SourceRepositories {
  const users = new MariaDbUserRepository(connection);
  const sources = new MariaDbSourceRepository(connection);
  const documents = new MariaDbDocumentRepository(connection);
  const revisions = new MariaDbRevisionRepository(connection);
  const tree = new MariaDbTreeRepository(connection);
  const workspaces = new MariaDbWorkspaceRepository(connection);
  const workspaceMemberships = new MariaDbWorkspaceMembershipRepository(connection);
  const workspaceAccess = new WorkspaceMembershipPolicy(workspaceMemberships);
  return {
    users,
    sources, entries: new MariaDbEntryRepository(connection), assets: new MariaDbAssetRepository(connection), syncRuns: new MariaDbSyncRunRepository(connection),
    documents, revisions, tree, sourcePolicy: new MariaDbSourcePolicyRepository(sources), workspaces, workspaceMemberships, workspaceAccess,
  };
}
