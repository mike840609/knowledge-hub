import { getWorkspaceSettings } from "@/server/workspace-settings-read";
import { AuditSettings } from "@/components/workspaces/audit-settings";
export default async function AuditPage({ params }: { params: Promise<{ workspaceId: string }> }) { const { workspaceId } = await params; const { services, caller } = await getWorkspaceSettings(workspaceId); const audit = await services.workspaceAdmin.listAudit(caller, workspaceId); return <AuditSettings workspaceId={workspaceId} initialPage={audit} />; }
