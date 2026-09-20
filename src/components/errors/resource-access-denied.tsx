import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

export function ResourceAccessDenied({ backHref }: { backHref: string }): React.JSX.Element {
  return (
    <main className="mx-auto min-h-screen max-w-2xl px-6 py-16">
      <h1 className="text-heading font-semibold text-kh-text">Access denied</h1>
      <p className="mt-3 text-body leading-6 text-kh-text-muted">
        This import session exists, but you no longer have permission to access its Workspace.
      </p>
      <Link
        className={buttonClasses({ variant: "link", className: "mt-6" })}
        href={backHref}
      >
        Back to Sources
      </Link>
    </main>
  );
}
