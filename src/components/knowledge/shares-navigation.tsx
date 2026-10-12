import Link from "next/link";
import { tabClasses, tabListClasses } from "@/components/ui/tab";

export function SharesNavigation({ workspaceId, active }: { workspaceId: string; active: "mine" | "saved" }) {
  const sections = [
    { id: "mine", label: "My shares", href: `/w/${workspaceId}/shares` },
    { id: "saved", label: "Saved shares", href: `/w/${workspaceId}/shares?tab=saved` },
  ] as const;

  return (
    <nav aria-label="Shares sections" className={`mt-4 ${tabListClasses}`}>
      {sections.map(section => (
        <Link key={section.id} href={section.href} aria-current={active === section.id ? "page" : undefined} className={tabClasses(active === section.id)}>
          {section.label}
        </Link>
      ))}
    </nav>
  );
}
