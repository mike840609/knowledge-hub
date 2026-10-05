/** Small illustrative examples, never a projection of workspace data. */
export function OnboardingIllustration({ kind }: { kind: "graph" | "context" }) {
  return <figure className="w-64 max-w-full">
    <svg viewBox="0 0 256 96" className="h-24 w-full" aria-hidden="true" focusable="false" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {kind === "graph" ? <>
        <path d="M55 44H119" className="stroke-kh-primary" />
        {[23, 119, 207].map((x, index) => <g key={x}>
          <rect x={x} y="24" width="32" height="40" rx="4" className={index === 2 ? "fill-kh-bg stroke-kh-border-strong" : "fill-kh-bg-selected stroke-kh-primary"} />
          <path d={`M${x + 8} 37h16 M${x + 8} 44h16 M${x + 8} 51h10`} className="stroke-kh-text-muted" />
        </g>)}
        <circle cx="87" cy="44" r="3" className="fill-kh-primary stroke-kh-primary" />
      </> : <>
        <rect x="8" y="12" width="88" height="72" rx="6" className="fill-kh-bg stroke-kh-border-strong" />
        {[28, 48, 68].map((y, index) => <g key={y}>
          <rect x="19" y={y - 5} width="10" height="10" rx="2" className={index < 2 ? "fill-kh-bg-selected stroke-kh-primary" : "stroke-kh-border-strong"} />
          {index < 2 ? <path d={`M21 ${y}l2 2 4-4`} className="stroke-kh-primary" /> : null}
          <path d={`M37 ${y}h45`} className="stroke-kh-text-muted" />
        </g>)}
        <path d="M109 48h28m-5-5 5 5-5 5" className="stroke-kh-primary" />
        <rect x="150" y="12" width="98" height="72" rx="6" className="fill-kh-bg stroke-kh-border-strong" />
        <path d="M163 27h28m-28 12h70m-70 8h58m-58 14h70m-70 8h44" className="stroke-kh-text-muted" />
      </>}
    </svg>
    <figcaption className="mt-2 text-caption text-kh-text-muted">{kind === "graph" ? "Example: linked and unlinked documents" : "Example: selected documents → Markdown preview"}</figcaption>
  </figure>;
}
