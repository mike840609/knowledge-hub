import Link from "next/link";
import { ActionIcon } from "@/components/actions/action-icon";
import { actionsFor, type Action, type ActionContext } from "@/components/actions/action-registry";
import type { KnowledgeTreeItem } from "@/modules/knowledge/application/knowledge-query-service";

/** The ways to put a first document in a workspace, in the order offered; Personal leads with the import. */
export function startActions(context: Omit<ActionContext, "onboarding">): Action[] {
  const actions = [...actionsFor("empty", { ...context, onboarding: true })];
  if (context.workspaceType === "PERSONAL") actions.sort((a, b) => Number(b.id === "create.import") - Number(a.id === "create.import"));
  return actions;
}

/** Archived documents count: a workspace whose documents are all archived is not one with nothing in it. */
export function hasNoDocuments(collections: { tree: KnowledgeTreeItem[] }[]): boolean {
  return collections.every(({ tree }) => tree.every((item) => item.type !== "document"));
}

/** Every workspace page draws its own empty state with the ways in, except a source with nothing to read. */
export function pageOffersStart(pathname: string, workspaceId: string): boolean {
  return !pathname.startsWith(`/w/${workspaceId}/knowledge/`);
}

/**
 * The explorer's tree when the workspace has no documents at all. An empty folder is one muted
 * line, but this is the first thing a new workspace shows, so it says how documents get here and
 * what each way leads to (frontend design language, empty states). `compact` is for a page whose own
 * empty state already does that (`pageOffersStart`): there the explorer is one muted line.
 */
export function SidebarGetStarted({ actions, compact = false }: { actions: Action[]; compact?: boolean }) {
  // Where the page beside it already offers these ways in, the explorer does not offer them again.
  if (compact) return <p className="px-2 py-3 text-body text-kh-text-muted">No documents yet</p>;
  return (
    <section aria-label="Get started" className="px-2 py-3">
      <p className="text-body font-medium text-kh-text">No documents yet</p>
      {actions.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {actions.map((action) =>
            action.effect.kind === "navigate" ? (
              <li key={action.id}>
                <Link href={action.effect.href} className="kh-interactive-row kh-focus-ring -mx-2 flex items-start gap-2 rounded-md px-2 py-2">
                  <ActionIcon name={action.icon} className="mt-0.5 h-4 w-4 shrink-0 text-kh-text-muted" />
                  <span className="min-w-0">
                    <span className="block text-body text-kh-text">{action.label}</span>
                    {action.detail ? <span className="block text-caption text-kh-text-muted">{action.detail}</span> : null}
                  </span>
                </Link>
              </li>
            ) : null,
          )}
        </ul>
      ) : (
        <p className="mt-1 text-caption text-kh-text-muted">You can read this workspace; adding to it needs edit access.</p>
      )}
    </section>
  );
}
