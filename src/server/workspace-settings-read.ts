import { notFound, redirect } from "next/navigation";
import { applicationServices } from "@/server/composition";
import { DomainError } from "@/shared/domain/errors";

/** Authorize every settings page before reading privileged membership/audit data. */
export async function getWorkspaceSettings(workspaceId: string) {
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  try {
    const state = await services.workspaceAdmin.workspaceState(caller, workspaceId);
    if (state.workspace.type !== "TEAM" || !state.actions.canOpenSettings) redirect(`/w/${workspaceId}/knowledge`);
    const team = await services.workspaceAdmin.teamView(caller, workspaceId);
    return { services, caller, team };
  } catch (error) {
    if (error instanceof DomainError && ["WORKSPACE_NOT_FOUND", "WORKSPACE_ACCESS_DENIED", "INSUFFICIENT_WORKSPACE_CAPABILITY"].includes(error.code)) notFound();
    throw error;
  }
}
