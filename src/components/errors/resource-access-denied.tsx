import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { StatusMessage } from "@/components/ui/status-message";

export function ResourceAccessDenied({ backHref }: { backHref: string }): React.JSX.Element {
  return (
    <main className="min-h-screen">
      <StatusMessage
        title="Access denied"
        description="This import session exists, but you no longer have permission to access its Workspace."
        action={
          <Link className={buttonClasses({ variant: "link" })} href={backHref}>
            Back to Sources
          </Link>
        }
      />
    </main>
  );
}
