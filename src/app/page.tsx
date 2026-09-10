import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">TSMC Knowledge Hub</p>
      <h1 className="mt-4 max-w-2xl text-4xl font-semibold tracking-tight text-ink sm:text-6xl">A stable home for team knowledge.</h1>
      <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">Phase 0 connects local identity, canonical Knowledge, and a MariaDB backed tree so later source sync and authoring can share one foundation.</p>
      <div className="mt-10">
        <Link className="inline-flex items-center rounded-md bg-accent px-5 py-3 font-medium text-white shadow-sm transition hover:bg-teal-800 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2" href="/knowledge">Open Knowledge Hub</Link>
      </div>
    </main>
  );
}
