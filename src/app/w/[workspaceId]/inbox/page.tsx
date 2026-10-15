import { notFound } from "next/navigation";
import { applicationServices } from "@/server/composition";
import { InboxActivityView } from "@/components/knowledge/inbox-activity-view";

export const dynamic = "force-dynamic";

export default async function InboxPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  const state = await services.workspaceAdmin.workspaceState(caller, workspaceId);
  if (state.workspace.type !== "PERSONAL") notFound();
  return <InboxActivityView workspaceId={workspaceId} />;
}
