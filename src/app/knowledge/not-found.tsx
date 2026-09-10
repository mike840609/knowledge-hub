import Link from "next/link";

export default function KnowledgeNotFound() {
  return <main className="mx-auto max-w-2xl px-6 py-16"><h1 className="text-2xl font-semibold text-ink">Document not found.</h1><p className="mt-3 text-slate-600">It may be archived or the identifier may be incorrect.</p><Link className="mt-6 inline-block text-sm font-semibold text-accent" href="/knowledge">Return to Knowledge</Link></main>;
}
