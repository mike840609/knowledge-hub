"use client";
import { useRouteRetry } from "@/components/shell/use-route-retry";
import { Button } from "@/components/ui/button";
import { StatusMessage } from "@/components/ui/status-message";

export default function ProfileError({ reset }: { reset: () => void }) {
  const retry = useRouteRetry(reset);
  return (
    <StatusMessage
      title="Statistics are temporarily unavailable"
      description="Your knowledge is still available. Try loading your overview again."
      action={<Button variant="secondary" onClick={retry}>Try again</Button>}
    />
  );
}
