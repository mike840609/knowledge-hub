import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
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
    return (
      <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6 py-16">
        <h1 className="text-2xl font-semibold">No workspace access</h1>
      </main>
    );
  }
  return <AppShell model={model}>{children}</AppShell>;
}
