"use client";

import { buttonClasses } from "@/components/ui/button";

export default function SourceDocumentError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-[860px] px-6 py-16">
      <h1 className="text-heading font-semibold text-kh-text">Something went wrong</h1>
      <p className="mt-2 text-body text-kh-text-muted">
        This section could not be loaded. The Source Tree is unchanged.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className={buttonClasses({ variant: "secondary", size: "lg", className: "mt-6" })}
      >
        Retry
      </button>
    </div>
  );
}
