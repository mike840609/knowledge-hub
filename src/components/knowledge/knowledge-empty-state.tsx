"use client";
import Link from "next/link";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { buttonClasses } from "@/components/ui/button";

export function KnowledgeEmptyState() {
  const { access, confirmed } = useWorkspaceAuthorization();
  return <section className="mx-auto flex max-w-3xl flex-col items-start gap-4 px-6 py-16">
    <h1 className="text-heading font-semibold">Knowledge</h1>
    <p className="text-body text-kh-text-muted">No documents yet. Add a note or import a folder to get started.</p>
    {access.actions.canWrite && confirmed && <Link className={buttonClasses({ size: "lg" })} href={`/w/${access.workspace.id}/knowledge/new`}>Add to Notes</Link>}
    {access.actions.canImport && confirmed && <Link className={buttonClasses({ variant: "secondary", size: "lg" })} href={`/w/${access.workspace.id}/sources/import`}>
      {access.workspace.type === "PERSONAL" ? "Import your first knowledge source" : "Import knowledge"}
    </Link>}
  </section>;
}
