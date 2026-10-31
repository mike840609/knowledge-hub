import { Suspense, type ReactNode } from "react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { SharesNavigation } from "@/components/knowledge/shares-navigation";
import { getFollowedDiscussions, requireSharesAccess, sharesNotFound } from "@/server/shares-read";

export const dynamic = "force-dynamic";

/**
 * The Shares shell: one 56rem header, one 64rem tab bar drawn once, and the tab
 * body below it. Proving access here keeps a 404 from ever wearing the "Shares"
 * header, and the cached helpers make the page's own check free.
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
          <Suspense fallback={<SharesNavigation workspaceId={workspaceId} />}>
            <FollowedCountNavigation workspaceId={workspaceId} />
          </Suspense>
        </div>
        {children}
      </div>
    </div>
  );
}

async function FollowedCountNavigation({ workspaceId }: { workspaceId: string }) {
  let unread = 0;
  try {
    unread = (await getFollowedDiscussions()).filter(item => item.linkAvailable && item.unread > 0).length;
  } catch {
    // The badge is optional; a failure here must not take the page down.
  }
  return <SharesNavigation workspaceId={workspaceId} discussionsUnread={unread} />;
}
