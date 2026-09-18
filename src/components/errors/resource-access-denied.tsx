import Link from "next/link";

export function ResourceAccessDenied({ backHref }: { backHref: string }): React.JSX.Element {
  return (
    <main className="mx-auto min-h-screen max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold text-kh-text">Access denied</h1>
      <p className="mt-3 text-sm leading-6 text-kh-text-muted">
        This import session exists, but you no longer have permission to access its Workspace.
      </p>
      <Link
        className="mt-6 inline-flex rounded text-sm font-medium text-kh-link underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-focus"
        href={backHref}
      >
        Back to Sources
      </Link>
    </main>
  );
}
