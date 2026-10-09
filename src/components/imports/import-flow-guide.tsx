import { ArrowDown, ArrowRight, Check, FileSearch, FolderOpen } from "lucide-react";

const steps = [
  { label: "Choose folder", detail: "Select your local Markdown folder.", Icon: FolderOpen },
  { label: "Preview", detail: "Review changes and resolve blockers.", Icon: FileSearch },
  { label: "Apply", detail: "Save the reviewed changes to your workspace.", Icon: Check },
];

export function ImportFlowGuide() {
  return (
    <details className="mt-2 text-body-sm">
      <summary className="kh-focus-ring w-fit cursor-pointer rounded-md text-kh-text-muted">How import works</summary>
      <ol aria-label="Folder import steps" className="mt-3 flex flex-col gap-3 border-y border-kh-border py-4 sm:flex-row sm:items-start sm:gap-4">
        {steps.map(({ label, detail, Icon }, index) => (
          <li key={label} className="flex min-w-0 items-start gap-3 sm:flex-1">
            {index > 0 ? <span aria-hidden="true" className="shrink-0 pt-1 text-kh-text-muted"><ArrowDown size={16} className="sm:hidden" /><ArrowRight size={16} className="hidden sm:block" /></span> : null}
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-medium text-kh-text"><Icon size={18} aria-hidden="true" className="shrink-0 text-kh-primary" />{label}</div>
              <p className="mt-1 text-kh-text-muted">{detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}
