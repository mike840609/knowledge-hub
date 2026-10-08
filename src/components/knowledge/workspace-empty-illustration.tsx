type Kind = "knowledge" | "sources" | "search" | "shares" | "insights" | "updates";
const captions: Record<Kind, string> = {
  knowledge: "Example: a folder becomes readable documents",
  sources: "Example: local Markdown → Preview → Apply",
  search: "Example: search your saved documents",
  shares: "Example: share a document with a link",
  insights: "Example: document counts and knowledge composition",
  updates: "Example: new and updated documents after Apply",
};

/** Illustrative shapes only; these are never workspace counts or records. */
export function WorkspaceEmptyIllustration({ kind }: { kind: Kind }) {
  const document = (x: number, y: number) => <g transform={`translate(${x} ${y})`}><rect width="34" height="44" rx="5" className="fill-kh-bg stroke-kh-border-strong" /><path d="M9 13h16M9 21h16M9 29h10" className="stroke-kh-text-muted" /></g>;
  const folder = (x: number, y: number) => <path transform={`translate(${x} ${y})`} d="M0 8Q0 3 5 3h16l7 7h29q5 0 5 5v32q0 5-5 5H5q-5 0-5-5Z" className="fill-kh-bg-selected stroke-kh-primary" />;
  if (kind === "sources") return <figure className="w-80 max-w-full">
    <svg viewBox="0 0 320 126" className="h-32 w-full" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="8" y="12" width="74" height="70" rx="8" className="fill-kh-bg stroke-kh-border-strong" />
      <path d="M25 25h8q2 0 4 2l4 4h22q5 0 5 5v25q0 5-5 5H25q-5 0-5-5V30q0-5 5-5Z" className="fill-kh-bg-selected stroke-kh-primary" />
      <text x="44" y="53" textAnchor="middle" stroke="none" className="fill-kh-primary text-caption">.md</text>
      <path d="M91 47h20m-5-5 5 5-5 5M209 47h20m-5-5 5 5-5 5" className="stroke-kh-primary" />
      <rect x="120" y="12" width="80" height="70" rx="8" className="fill-kh-bg stroke-kh-border-strong" />
      <path d="M133 34h10m-5-5v10" className="stroke-kh-success" /><path d="M151 34h35M151 55h29" className="stroke-kh-text-muted" />
      <path d="M144 55a6 6 0 1 1-3-5M143 45v6h-6" className="stroke-kh-primary" />
      <rect x="238" y="12" width="74" height="70" rx="8" className="fill-kh-bg stroke-kh-border-strong" />
      <rect x="253" y="24" width="26" height="37" rx="5" className="fill-kh-bg stroke-kh-border-strong" /><path d="M260 34h12M260 42h12M260 50h8" className="stroke-kh-text-muted" /><path d="M280 62l4 4 8-9" className="stroke-kh-primary" />
      <g stroke="none" className="fill-kh-text text-caption" textAnchor="middle"><text x="45" y="103">Local folder</text><text x="160" y="103">Preview</text><text x="275" y="103">Apply</text></g>
    </svg>
    <figcaption className="mt-2 text-caption text-kh-text-muted">{captions.sources}</figcaption>
  </figure>;
  return <figure className="w-64 max-w-full">
    <svg viewBox="0 0 256 112" className="h-28 w-full" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {kind === "knowledge" ? <>
        {folder(18, 27)}<path d="M91 55h37m-6-6 6 6-6 6" className="stroke-kh-primary" />
        {document(150, 36)}{document(194, 23)}
      </> : kind === "search" ? <>
        <rect x="20" y="9" width="216" height="29" rx="6" className="fill-kh-bg stroke-kh-border-strong" /><circle cx="36" cy="22" r="5" className="stroke-kh-primary" /><path d="M40 26l4 4M55 23h94" className="stroke-kh-text-muted" />
        {document(27, 53)}<path d="M74 63h119M74 74h151M74 85h80" className="stroke-kh-text-muted" />
      </> : kind === "shares" ? <>
        {document(38, 34)}<path d="M89 56h34m-6-6 6 6-6 6" className="stroke-kh-primary" />
        <rect x="142" y="33" width="89" height="44" rx="7" className="fill-kh-bg stroke-kh-border-strong" /><path d="M164 59l-3 3a8 8 0 0 1-11-11l7-7a8 8 0 0 1 11 0M165 52l3-3a8 8 0 0 1 11 11l-7 7a8 8 0 0 1-11 0M162 57l7-7M192 55h26" className="stroke-kh-primary" />
      </> : kind === "insights" ? <>
        <rect x="23" y="15" width="210" height="83" rx="7" className="fill-kh-bg stroke-kh-border-strong" />
        <path d="M39 34h39M39 45h24M39 66h60M39 77h44M136 80h78" className="stroke-kh-text-muted" />
        {[{ x: 141, y: 62 }, { x: 165, y: 45 }, { x: 189, y: 32 }].map(({ x, y }) => <rect key={x} x={x} y={y} width="14" height={80 - y} rx="2" className="fill-kh-bg-selected stroke-kh-primary" />)}
      </> : <>
        {document(29, 33)}<path d="M80 55h32m-6-6 6 6-6 6" className="stroke-kh-primary" />
        <rect x="131" y="19" width="105" height="75" rx="7" className="fill-kh-bg stroke-kh-border-strong" />
        <path d="M146 40h12M152 34v12" className="stroke-kh-success" /><path d="M171 40h48M171 71h37" className="stroke-kh-text-muted" /><path d="M158 70a7 7 0 1 1-3-6M156 59v7h-7" className="stroke-kh-primary" />
      </>}
    </svg>
    <figcaption className="mt-2 text-caption text-kh-text-muted">{captions[kind]}</figcaption>
  </figure>;
}
