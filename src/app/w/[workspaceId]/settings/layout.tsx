import type { ReactNode } from "react";
import { getWorkspaceSettings } from "@/server/workspace-settings-read";
import { PageHeader } from "@/components/shell/page-header";
import { NavTabs, type NavTab } from "@/components/shell/nav-tabs";

const SECTIONS: readonly [string, string][] = [
  ["", "General"],
  ["/members", "Members"],
  ["/groups", "SSO Groups"],
  ["/audit", "Audit"],
];

export default async function SettingsLayout({
  params,
  children,
}: {
  params: Promise<{ workspaceId: string }>;
  children: ReactNode;
}) {
  const { workspaceId } = await params;
  const { team } = await getWorkspaceSettings(workspaceId);
  const tabs: NavTab[] = SECTIONS.map(([path, label]) => ({
    href: `/w/${workspaceId}/settings${path}`,
    label,
  }));

  return (
    <main className="kh-page-wide py-6">
      <PageHeader location={team.name} locationHref={`/w/${workspaceId}/knowledge`} title="Settings" />
      <div className="my-6">
        <NavTabs label="Team settings" tabs={tabs} />
      </div>
      {children}
    </main>
  );
}
