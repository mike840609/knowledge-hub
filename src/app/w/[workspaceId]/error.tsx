"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Button, buttonClasses } from "@/components/ui/button";
import { StatusMessage } from "@/components/ui/status-message";

/**
 * Covers every workspace route that had no boundary of its own — search,
 * sources and settings — while the knowledge tree keeps its narrower one.
 * Rendering inside the workspace layout means the shell and the sidebar
 * survive the error, so the reader can navigate away rather than reload.
 */
export default function WorkspaceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  return (
    <StatusMessage
      title="This page could not be loaded"
      description="Check your connection and try again. If the problem continues, return to Knowledge and try opening another document."
      action={<>
        <Button variant="secondary" size="lg" onClick={() => reset()}>Retry this page</Button>
        <Link className={buttonClasses({ variant: "ghost", size: "lg" })} href={`/w/${encodeURIComponent(workspaceId)}/knowledge`}>Return to Knowledge</Link>
      </>}
    />
  );
}
