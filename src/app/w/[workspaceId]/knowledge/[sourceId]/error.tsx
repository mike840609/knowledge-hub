"use client";

import { Button } from "@/components/ui/button";
import { StatusMessage } from "@/components/ui/status-message";

export default function SourceDocumentError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <StatusMessage
      title="Something went wrong"
      description="This section could not be loaded. The Source Tree is unchanged."
      action={<Button variant="secondary" size="lg" onClick={() => reset()}>Retry</Button>}
    />
  );
}
