"use client";
import Link from "next/link";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";

export function KnowledgeEmptyState() {
  const { access, confirmed } = useWorkspaceAuthorization();
  return <section className="mx-auto flex max-w-3xl flex-col items-start gap-4 px-6 py-16">
    <h1 className="text-2xl font-semibold">Knowledge</h1>
    <p className="text-sm text-kh-text-muted">No documents yet. Add a note or import a folder to get started.</p>
    {access.actions.canWrite && confirmed && <Link className="rounded-md bg-kh-primary hover:bg-kh-primary-hover px-4 py-2 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kh-focus" href={`/w/${access.workspace.id}/knowledge/new`}>Add to Notes</Link>}
    {access.actions.canImport && confirmed && <Link className="rounded-md border border-kh-border bg-kh-bg px-4 py-2 text-sm font-medium text-kh-text hover:bg-kh-bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-focus focus-visible:ring-offset-2" href={`/w/${access.workspace.id}/sources/import`}>
      {access.workspace.type === "PERSONAL" ? "Import your first knowledge source" : "Import knowledge"}
    </Link>}
  </section>;
}
