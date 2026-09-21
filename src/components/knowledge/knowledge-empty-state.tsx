"use client";
import Link from "next/link";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { buttonClasses } from "@/components/ui/button";
import { StatusMessage } from "@/components/ui/status-message";

export function KnowledgeEmptyState() {
  const { access, confirmed } = useWorkspaceAuthorization();
  return (
    <section>
      <StatusMessage
        title="Knowledge"
        description="No documents yet. Add a note or import a folder to get started."
        action={
          <>
            {access.actions.canWrite && confirmed && (
              <Link
                className={buttonClasses({ size: "lg" })}
                href={`/w/${access.workspace.id}/knowledge/new`}
              >
                Add to Notes
              </Link>
            )}
            {access.actions.canImport && confirmed && (
              <Link
                className={buttonClasses({ variant: "secondary", size: "lg" })}
                href={`/w/${access.workspace.id}/sources/import`}
              >
                {access.workspace.type === "PERSONAL"
                  ? "Import your first knowledge source"
                  : "Import knowledge"}
              </Link>
            )}
          </>
        }
      />
    </section>
  );
}
