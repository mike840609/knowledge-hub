import type { ReactNode } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { foreignHubShareRedirect, REQUEST_PATH_HEADER } from "@/lib/share-paths";
import { applicationServices } from "@/server/composition";
import { getWorkspaceShellModel } from "@/server/knowledge-read";

export default async function WorkspaceLayout({
  params,
  children,
}: {
  params: Promise<{ workspaceId: string }>;
  children: ReactNode;
}) {
  const { workspaceId } = await params;
  const model = await getWorkspaceShellModel(workspaceId);
  if (!model) {
    // A share's Hub reader URL copied from another person's Workspace opens in the caller's own; every other foreign path is a 404.
    const { personalWorkspace } = await applicationServices().establishTrustedCaller();
    const own = foreignHubShareRedirect((await headers()).get(REQUEST_PATH_HEADER), personalWorkspace.id);
    if (own && personalWorkspace.id !== workspaceId) redirect(own);
    notFound();
  }
  return <AppShell key={workspaceId} model={model}>{children}</AppShell>;
}
