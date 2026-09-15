"use client";
import Link from "next/link";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";

export function KnowledgeEmptyState() {
  const { access, confirmed } = useWorkspaceAuthorization();
  return <section className="mx-auto flex max-w-3xl flex-col items-start gap-4 px-6 py-16">
    <h1 className="text-2xl font-semibold">Knowledge</h1>
    <p className="text-sm text-kh-text-muted">No knowledge sources yet.</p>
    {access.actions.canImport && confirmed && <Link className="rounded-md bg-kh-accent px-4 py-2 text-sm font-medium text-white" href={`/w/${access.workspace.id}/sources/import`}>
      {access.workspace.type === "PERSONAL" ? "Import your first knowledge source" : "Import knowledge"}
    </Link>}
  </section>;
}
