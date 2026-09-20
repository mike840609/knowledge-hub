"use client";

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
        className="mt-6 inline-flex h-9 items-center rounded-md border border-kh-border bg-kh-bg px-4 text-body font-medium text-kh-text hover:bg-kh-bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-focus"
      >
        Retry
      </button>
    </div>
  );
}
