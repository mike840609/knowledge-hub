"use client";

export default function KnowledgeError({ reset }: { reset: () => void }) {
  return <main className="mx-auto max-w-2xl px-6 py-16"><h1 className="text-2xl font-semibold text-ink">Knowledge is temporarily unavailable.</h1><p className="mt-3 text-slate-600">Check the local database and try the request again.</p><button className="mt-6 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white" onClick={() => reset()}>Try again</button></main>;
}
