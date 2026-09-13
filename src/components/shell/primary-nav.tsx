import Link from "next/link";
import { BookOpenText, Database } from "lucide-react";

export function PrimaryNav({ workspaceId }: { workspaceId: string }) {
  const items = [
    {
      name: "Knowledge",
      href: `/w/${workspaceId}/knowledge`,
      Icon: BookOpenText,
    },
    {
      name: "Sources",
      href: `/w/${workspaceId}/sources`,
      Icon: Database,
    },
  ];
  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5 p-2">
      {items.map(({ name, href, Icon }) => (
        <Link
          key={name}
          href={href}
          className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-kh-text-muted transition hover:bg-kh-bg-hover hover:text-kh-text"
        >
          <Icon size={15} strokeWidth={2} aria-hidden="true" />
          <span>{name}</span>
        </Link>
      ))}
    </nav>
  );
}
