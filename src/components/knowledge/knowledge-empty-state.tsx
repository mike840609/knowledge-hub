"use client";
import Link from "next/link";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { buttonClasses } from "@/components/ui/button";
import { StatusMessage } from "@/components/ui/status-message";
import { ActionIcon } from "@/components/actions/action-icon";
import { actionsFor } from "@/components/actions/action-registry";

/**
 * An empty state answers one question: what can I do from here. It asks the
 * registry rather than hard-coding two buttons, so a reader who cannot write
 * and cannot import is told that plainly instead of being shown a heading with
 * nothing under it — and so a future action arrives here without anyone having
 * to remember this file exists.
 */
export function KnowledgeEmptyState() {
  const { access, confirmed } = useWorkspaceAuthorization();
  const actions = actionsFor("empty", {
    workspaceId: access.workspace.id,
    workspaceType: access.workspace.type,
    can: access.actions,
    confirmed,
    onboarding: true,
  });

  return (
    <section>
      <StatusMessage
        title="Knowledge"
        description={
          actions.length > 0
            ? "No documents yet. Add a note or import a folder to get started."
            : "No documents yet. You can read this workspace; adding to it needs edit access."
        }
        action={
          <>
            {actions.map((action, index) =>
              action.effect.kind === "navigate" ? (
                <Link
                  key={action.id}
                  className={buttonClasses({
                    size: "lg",
                    variant: index === 0 ? "primary" : "secondary",
                  })}
                  href={action.effect.href}
                >
                  <ActionIcon name={action.icon} className="h-4 w-4 shrink-0" />
                  {action.label}
                </Link>
              ) : null,
            )}
          </>
        }
      />
    </section>
  );
}
