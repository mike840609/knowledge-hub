import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { tabClasses, tabListClasses } from "@/components/ui/tab";

export function SharesNavigation({ workspaceId, active, discussionsUnread = 0 }: { workspaceId: string; active: "mine" | "saved" | "discussions"; discussionsUnread?: number }) {
  const sections = [
    { id: "mine", label: "My shares", href: `/w/${workspaceId}/shares` },
    { id: "saved", label: "Saved shares", href: `/w/${workspaceId}/shares?tab=saved` },
    { id: "discussions", label: "Discussions", href: `/w/${workspaceId}/shares?tab=discussions` },
  ] as const;

  return (
    <nav aria-label="Shares sections" className={`mt-4 ${tabListClasses}`}>
      {sections.map(section => (
        <Link key={section.id} href={section.href} aria-current={active === section.id ? "page" : undefined} className={tabClasses(active === section.id)}>
          {section.label}
          {section.id === "discussions" && discussionsUnread > 0 && <span aria-label={`${discussionsUnread} unread`} className="ml-1 tabular-nums text-caption text-kh-text-muted">{discussionsUnread}</span>}
        </Link>
      ))}
    </nav>
  );
}

/** The page's title, its section tabs, then what this section holds: the tabs never depend on the
 * length of the sentence below them. */
export function SharesHeader({ workspaceId, active, discussionsUnread = 0, description }: { workspaceId: string; active: "mine" | "saved" | "discussions"; discussionsUnread?: number; description: string }) {
  return (
    <>
      <PageHeader location="My Space" locationHref={`/w/${workspaceId}/home`} title="Shares" />
      <SharesNavigation workspaceId={workspaceId} active={active} discussionsUnread={discussionsUnread} />
      <p className="mt-3 text-body-sm text-kh-text-muted">{description}</p>
    </>
  );
}
