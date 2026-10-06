/** Small illustrative examples, never a projection of workspace data. */
export function OnboardingIllustration({ kind }: { kind: "graph" | "context" }) {
  return <figure className="w-64 max-w-full">
    <svg viewBox="0 0 256 96" className="h-24 w-full" aria-hidden="true" focusable="false" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {kind === "graph" ? <>
        {/* Draw links first so the opaque document shapes hide their endpoints. */}
        <path d="M97 19L64 76.158H130L97 19" className="stroke-kh-primary" />
        <path d="M48 20V28 M44 24H52 M151 36V42 M148 39H154" className="stroke-kh-primary" opacity="0.45" />
        {[{ x: 81, y: 0 }, { x: 48, y: 57.158 }, { x: 114, y: 57.158 }, { x: 210, y: 29 }].map(({ x, y }, index) => {
          const unlinked = index === 3;
          const outline = unlinked ? "stroke-kh-border-strong" : "stroke-kh-primary";
          return <g key={x} transform={`translate(${x} ${y})`}>
            <path
              d="M6 0H22Q23 0 24 1L31 8Q32 9 32 11V32Q32 38 26 38H6Q0 38 0 32V6Q0 0 6 0Z"
              className={`${unlinked ? "fill-kh-bg" : "fill-kh-bg-selected"} ${outline}`}
            />
            <path d="M23 1V6Q23 9 26 9H31" className={outline} />
            <path d="M8 16H21" className="stroke-kh-text-muted" opacity="0.55" />
            <path d="M8 23H24 M8 29H19" className="stroke-kh-text-muted" />
          </g>;
        })}
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
