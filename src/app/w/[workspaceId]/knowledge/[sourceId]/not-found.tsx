export default function SourceDocumentNotFound() {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-[860px] flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold text-kh-text">Not found or no access</h1>
      <p className="mt-2 text-sm text-kh-text-muted">
        This content does not exist or you do not have access to it.
      </p>
    </main>
  );
}
