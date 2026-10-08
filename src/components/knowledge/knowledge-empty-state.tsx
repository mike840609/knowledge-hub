"use client";
import { WorkspaceEmptyIllustration } from "@/components/knowledge/workspace-empty-illustration";

import Link from "next/link";
import { FileText } from "lucide-react";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Kbd } from "@/components/ui/kbd";
import { ActionIcon } from "@/components/actions/action-icon";
import { actionsFor } from "@/components/actions/action-registry";
import { shortcutLabel } from "@/lib/shortcut-keys";

/**
 * An empty state answers one question: what can I do from here. It asks the
 * registry rather than hard-coding two buttons, so a reader who cannot write
 * and cannot import is told that plainly instead of being shown a heading with
 * nothing under it — and so a future action arrives here without anyone having
 * to remember this file exists.
 *
 * Only the first action is the primary one; the rest are secondary, so two
 * equal-weight buttons never ask the reader to choose. The first action's own
 * shortcut, if it has one, is taught underneath.
 */
export function KnowledgeEmptyState() {
  const { access, confirmed } = useWorkspaceAuthorization();
  const available = actionsFor("empty", {
    workspaceId: access.workspace.id,
    workspaceType: access.workspace.type,
    can: access.actions,
    confirmed,
    onboarding: true,
  });
  const actions = [...available];
  if (access.workspace.type === "PERSONAL") actions.sort((a, b) => Number(b.id === "create.import") - Number(a.id === "create.import"));
  const first = actions[0];

  return (
    <section>
      <EmptyState
        icon={FileText} illustration={<WorkspaceEmptyIllustration kind="knowledge" />}
        title="No documents yet"
        description={
          actions.length > 0
            ? "Browse and read your saved knowledge here. Import a Markdown folder or create a note to add your first document."
            : "You can read this workspace; adding to it needs edit access."
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
        hint={
          first?.shortcut ? (
            <>
              Shortcut <Kbd>{shortcutLabel(first.shortcut)}</Kbd> {first.label}
            </>
          ) : undefined
        }
      />
    </section>
  );
}
