"use client";
import { Button } from "@/components/ui/button";
import { StatusMessage } from "@/components/ui/status-message";

export default function ProfileError({ reset }: { reset: () => void }) {
  return (
    <StatusMessage
      title="Statistics are temporarily unavailable"
      description="Your knowledge is still available. Try loading your overview again."
      action={<Button variant="secondary" onClick={reset}>Try again</Button>}
    />
  );
}
