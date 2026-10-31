"use client";
import { PageHeader } from "@/components/shell/page-header";
import { Illustration } from "@/components/knowledge/illustration";

import { FileText } from "lucide-react";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { EmptyState } from "@/components/ui/empty-state";
import { Kbd } from "@/components/ui/kbd";
import { WorkspaceContentActions } from "@/components/knowledge/workspace-content-actions";
import { startActions } from "@/components/knowledge/sidebar-get-started";
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
  const actions = startActions({
    workspaceId: access.workspace.id,
    workspaceType: access.workspace.type,
    isPersonalOwner: access.isPersonalOwner,
    can: access.actions,
    confirmed,
  });
  const first = actions[0];

  return (
    <section className="kh-page pb-6">
      <PageHeader location={access.workspace.type === "PERSONAL" ? "My Space" : access.workspace.name} locationHref={`/w/${access.workspace.id}/${access.workspace.type === "PERSONAL" ? "home" : "sources"}`} title="Knowledge" />
      <EmptyState
        icon={FileText} illustration={<Illustration kind="start" importFirst={first?.id !== "create.document"} />}
        title="No documents yet"
        description={
          access.workspace.type === "TEAM"
            ? "團隊的內容從成員的 My Space 發佈而來。在 My Space 的資料夾或文件選「發佈到團隊」。"
            : actions.length > 0
              ? "Imported folders stay read-only here; documents you write stay editable."
              : "You can read this workspace; adding to it needs edit access."
        }
        action={<WorkspaceContentActions workspaceId={access.workspace.id} />}
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
