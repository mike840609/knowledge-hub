"use client";

import { Button } from "@/components/ui/button";
import { StatusMessage } from "@/components/ui/status-message";

/**
 * Covers every workspace route that had no boundary of its own — search,
 * sources and settings — while the knowledge tree keeps its narrower one.
 * Rendering inside the workspace layout means the shell and the sidebar
 * survive the error, so the reader can navigate away rather than reload.
 */
export default function WorkspaceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <StatusMessage
      title="Something went wrong"
      description="This page could not be loaded. Nothing was changed."
      action={<Button variant="secondary" size="lg" onClick={() => reset()}>Retry</Button>}
    />
  );
}
