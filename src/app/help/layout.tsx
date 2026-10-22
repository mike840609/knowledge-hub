import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { getWorkspaceShellModel } from "@/server/knowledge-read";
import { helpWorkspaceId } from "@/server/help-read";

/** The guides read inside the reader's own My Space, so the shell around them is theirs. */
export default async function HelpLayout({ children }: { children: ReactNode }) {
  const workspaceId = await helpWorkspaceId();
  const model = await getWorkspaceShellModel(workspaceId);
  if (!model) notFound();
  return <AppShell key={workspaceId} model={model}>{children}</AppShell>;
}
