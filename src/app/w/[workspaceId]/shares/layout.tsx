import { Suspense, type ReactNode } from "react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { SharesNavigation } from "@/components/knowledge/shares-navigation";
import { getFollowedDiscussions, requireSharesAccess, sharesNotFound } from "@/server/shares-read";

export const dynamic = "force-dynamic";

/**
 * The Shares shell: one 56rem header, one 64rem tab bar drawn once, and the tab
 * body below it. Only the unread badge suspends; replacing the navigation itself
 * would reset its optimistic selection during a tab transition. Access is checked
 * before drawing the shell, and the cached helpers avoid repeated queries.
 */
export default async function SharesLayout({ children, params }: { children: ReactNode; params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  try {
    await requireSharesAccess(workspaceId);
  } catch (error) {
    if (sharesNotFound(error)) notFound();
    throw error;
  }
  return (
    <div className="pb-6">
      <div className="kh-page">
        <PageHeader location="My Space" locationHref={`/w/${workspaceId}/home`} title="Shares" />
      </div>
      <div className="kh-page-wide">
        <div className="mt-4">
          <Suspense fallback={null}>
            <SharesNavigation
              workspaceId={workspaceId}
              discussionsBadge={<Suspense fallback={null}><FollowedCountBadge /></Suspense>}
            />
          </Suspense>
        </div>
        {children}
      </div>
    </div>
  );
}

async function FollowedCountBadge() {
  let unread = 0;
  try {
    unread = (await getFollowedDiscussions()).filter(item => item.linkAvailable && item.unread > 0).length;
  } catch {
    // The badge is optional; a failure here must not take the page down.
  }
  return unread > 0
    ? <span aria-label={`${unread} unread`} className="ml-1 tabular-nums text-caption text-kh-text-muted">{unread}</span>
    : null;
}
