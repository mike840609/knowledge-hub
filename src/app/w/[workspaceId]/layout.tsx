import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { getWorkspaceExplorerModel, getWorkspaceShellModel } from "@/server/knowledge-read";

export default async function WorkspaceLayout({
  params,
  children,
}: {
  params: Promise<{ workspaceId: string }>;
  children: ReactNode;
}) {
  const { workspaceId } = await params;
  const [model, explorer] = await Promise.all([getWorkspaceShellModel(workspaceId), getWorkspaceExplorerModel(workspaceId)]);
  if (!model) notFound();
  return <AppShell key={workspaceId} model={model} explorer={explorer}>{children}</AppShell>;
}
