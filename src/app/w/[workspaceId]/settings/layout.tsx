import Link from "next/link";
import type { ReactNode } from "react";
import { getWorkspaceSettings } from "@/server/workspace-settings-read";
import { PageHeader } from "@/components/shell/page-header";
export default async function SettingsLayout({ params, children }: { params: Promise<{ workspaceId: string }>; children: ReactNode }) {
  const { workspaceId } = await params; const { team } = await getWorkspaceSettings(workspaceId);
  return <main className="mx-auto max-w-5xl px-6 py-6"><PageHeader location={team.name} locationHref={`/w/${workspaceId}/knowledge`} title="Settings" /><nav aria-label="Team settings" className="my-6 flex flex-wrap gap-5 border-b border-kh-border pb-3">{[["", "General"], ["/members", "Members"], ["/groups", "SSO Groups"], ["/audit", "Audit"]].map(([path, label]) => <Link className="text-body text-kh-text hover:underline" key={path} href={`/w/${workspaceId}/settings${path}`}>{label}</Link>)}</nav>{children}</main>;
}
