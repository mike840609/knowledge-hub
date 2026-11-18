"use client";

import Link from "next/link";
import { useContext } from "react";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { Button, buttonClasses } from "@/components/ui/button";
import { useRouteRetry } from "@/components/shell/use-route-retry";
import { WorkspaceAuthorizationContext } from "@/components/shell/use-workspace-authorization";

/**
 * Shares is the one route whose whole page is a database read. When that read
 * fails, the generic workspace boundary tells the reader to check their
 * connection and open another document — neither of which is true or useful
 * here. Keep the page's header and say what failed, how to retry, and which
 * reference support needs.
 */
export default function SharesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const authorization = useContext(WorkspaceAuthorizationContext);
  const retry = useRouteRetry(reset);
  const location = authorization?.access.workspace.name ?? "My Space";
  return (
    <div className="pb-6">
      <div className="kh-page">
        <PageHeader location={location} locationHref={`/w/${workspaceId}/home`} title="Shares" />
      </div>
      <div className="kh-reading-column py-16">
        <h2 className="text-heading font-semibold text-kh-text">Share links couldn&apos;t be loaded</h2>
        <p className="mt-2 text-body text-kh-text-muted">
          The server could not read this page&apos;s share links. Nothing was changed, so retrying is safe.
        </p>
        {error.digest ? (
          <p className="mt-3 text-caption text-kh-text-muted">
            Reference{" "}
            <code className="rounded-sm bg-kh-bg-subtle px-1 py-0.5 font-mono text-caption text-kh-text-secondary">{error.digest}</code>{" "}
            if you need to report this.
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={retry}>Retry</Button>
          <Link className={buttonClasses({ variant: "secondary" })} href={`/w/${workspaceId}/knowledge`}>
            Return to Knowledge
          </Link>
        </div>
      </div>
    </div>
  );
}
