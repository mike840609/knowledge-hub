"use client";

import { Button } from "@/components/ui/button";
import { StatusMessage } from "@/components/ui/status-message";

export default function DocumentReadError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <StatusMessage
      title="This document could not be loaded"
      description="A temporary problem interrupted the read. Your place in the workspace is unchanged; try again."
      action={<Button variant="secondary" size="lg" onClick={() => reset()}>Retry</Button>}
    />
  );
}
