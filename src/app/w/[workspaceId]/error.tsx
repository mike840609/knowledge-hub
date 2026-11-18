"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useRouteRetry } from "@/components/shell/use-route-retry";
import { Button, buttonClasses } from "@/components/ui/button";
import { StatusMessage } from "@/components/ui/status-message";

/**
 * Covers every workspace route that had no boundary of its own — search,
 * sources and settings — while the knowledge tree keeps its narrower one.
 * Rendering inside the workspace layout means the shell and the sidebar
 * survive the error, so the reader can navigate away rather than reload.
 */
export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const retry = useRouteRetry(reset);
  return (
    <StatusMessage
      title="This page could not be loaded"
      description={<>
        The server could not load this page. Nothing was changed, so retrying is safe.
        {error.digest ? <> Reference <code className="rounded-sm bg-kh-bg-subtle px-1 py-0.5 font-mono text-caption text-kh-text-secondary">{error.digest}</code> if you need to report this.</> : null}
      </>}
      action={<>
        <Button size="lg" onClick={retry}>Retry this page</Button>
        <Link className={buttonClasses({ variant: "secondary", size: "lg" })} href={`/w/${encodeURIComponent(workspaceId)}/knowledge`}>Return to Knowledge</Link>
      </>}
    />
  );
}
