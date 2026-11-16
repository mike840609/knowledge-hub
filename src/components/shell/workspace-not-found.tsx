"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { buttonClasses } from "@/components/ui/button";
import { StatusMessage } from "@/components/ui/status-message";

/**
 * Not found, or no access, inside a Workspace the reader can open (the Workspace layout has already
 * judged that): the same words for both, and two ways out, so a dead link is never a dead end.
 */
export function WorkspaceNotFound() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  return (
    <StatusMessage
      title="Not found or no access"
      description="This content does not exist or you do not have access to it."
      action={
        <>
          <Link href={`/w/${encodeURIComponent(workspaceId)}/knowledge`} className={buttonClasses({ variant: "secondary", size: "lg" })}>
            Back to this workspace
          </Link>
          <Link href="/" className={buttonClasses({ variant: "ghost", size: "lg" })}>
            Go to my workspace
          </Link>
        </>
      }
    />
  );
}
