/** The page's shape, not a different dashboard: header line, the two-column pair, then the chart. */
export default function ProfileLoading() {
  return <main className="kh-page-wide pb-6" aria-busy="true" aria-label="Loading personal statistics">
    <p role="status" className="sr-only">Loading your knowledge overview…</p>
    <div className="h-12" />
    <div className="grid grid-cols-1 gap-6 pt-6 sm:grid-cols-2">
      <div className="space-y-4">
        <div className="h-5 w-40 rounded-md bg-kh-bg-subtle" />
        <div className="h-4 w-56 rounded-md bg-kh-bg-subtle" />
        <div className="h-2 w-full rounded-md bg-kh-bg-subtle" />
        <div className="h-3 w-48 rounded-md bg-kh-bg-subtle" />
      </div>
      <div className="space-y-4">
        <div className="h-5 w-48 rounded-md bg-kh-bg-subtle" />
        <div className="h-4 w-52 rounded-md bg-kh-bg-subtle" />
        {[0, 1, 2].map(i => <div key={i} className="space-y-2">
          <div className="h-2 w-full rounded-md bg-kh-bg-subtle" />
          <div className="h-3 w-36 rounded-md bg-kh-bg-subtle" />
        </div>)}
      </div>
    </div>
    <div className="mt-6 h-64 rounded-md bg-kh-bg-subtle" />
  </main>;
}
