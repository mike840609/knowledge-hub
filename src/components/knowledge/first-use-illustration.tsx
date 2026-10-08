import { ArrowRight, Check, FileText, Folder, Search } from "lucide-react";
import { OnboardingIllustration } from "./onboarding-illustration";

type Step = "import" | "reading" | "search" | "context";
const captions = {
  import: "Example: folder → Preview → Apply",
  reading: "Example: document and source path",
  search: "Example: search and matching documents",
};

/** Static examples: no live data, controls, or simulated interaction. */
export function FirstUseIllustration({ kind }: { kind: Step }) {
  if (kind === "context") return <div className="flex min-h-40 items-center justify-center rounded-lg bg-kh-bg-subtle p-3"><OnboardingIllustration kind="context" /></div>;
  return <figure className="flex min-h-40 flex-col justify-center rounded-lg bg-kh-bg-subtle p-3">
    <div aria-hidden="true" className="flex h-24 items-center justify-center gap-2 text-kh-text-muted">
      {kind === "import" ? <>
        <div className="flex flex-col items-center gap-2"><Folder size={30} strokeWidth={1.3} className="text-kh-primary" /><span className="text-caption">Folder</span></div>
        <ArrowRight size={16} className="shrink-0" />
        <div className="rounded-md border border-kh-border bg-kh-bg p-2 text-caption"><div className="mb-1 font-medium text-kh-text">Preview</div><div className="text-kh-success">+ new.md</div><div>↻ notes.md</div></div>
        <ArrowRight size={16} className="shrink-0" /><div className="flex items-center gap-1 rounded-md bg-kh-bg-selected px-2 py-1 text-caption text-kh-primary"><Check size={12} />Apply</div>
      </> : kind === "reading" ? <div className="w-full max-w-64 rounded-md border border-kh-border bg-kh-bg p-3">
        <div className="flex items-center gap-2 text-body-sm font-medium text-kh-text"><FileText size={14} />Project notes</div>
        <div className="mt-1 truncate text-caption">My folder · docs/notes.md</div>
        <div className="mt-3 h-1 w-4/5 rounded bg-kh-border" /><div className="mt-2 h-1 w-full rounded bg-kh-border" /><div className="mt-2 h-1 w-3/5 rounded bg-kh-border" />
      </div> : <div className="w-full max-w-64 rounded-md border border-kh-border bg-kh-bg p-2">
        <div className="flex items-center gap-2 rounded border border-kh-border px-2 py-1 text-caption"><Search size={12} />project</div>
        <div className="mt-2 flex items-center gap-2 text-caption text-kh-text"><FileText size={12} /><span><mark className="bg-kh-bg-selected text-kh-primary">Project</mark> notes</span></div>
        <div className="mt-1 flex items-center gap-2 text-caption"><FileText size={12} />Project checklist</div>
      </div>}
    </div>
    <figcaption className="mt-2 text-center text-caption text-kh-text-muted">{captions[kind]}</figcaption>
  </figure>;
}
