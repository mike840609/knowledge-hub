type Kind = "start" | "sources" | "search" | "shares" | "insights" | "updates" | "graph" | "context" | "reading";

/*
 * One set of shapes on one 256×96 canvas, so every example reads as the same hand. Objects (a document,
 * a folder) are drawn bare; only what is itself a screen surface (a search box, a preview, a link, a
 * page) sits in a panel. The accent marks the subject; everything else is neutral. A drawing carries its
 * meaning without a caption: the page's title and one line of text say the rest.
 */
const muted = "stroke-kh-text-muted";

function Doc({ x, y, accent = false }: { x: number; y: number; accent?: boolean }) {
  const outline = accent ? "stroke-kh-primary" : "stroke-kh-border-strong";
  return <g transform={`translate(${x} ${y})`}>
    <path d="M6 0H22Q23 0 24 1L31 8Q32 9 32 11V32Q32 38 26 38H6Q0 38 0 32V6Q0 0 6 0Z" className={`${accent ? "fill-kh-bg-selected" : "fill-kh-bg"} ${outline}`} />
    <path d="M23 1V6Q23 9 26 9H31" className={outline} />
    <path d="M8 16H21" className={muted} opacity="0.55" />
    <path d="M8 23H24 M8 29H19" className={muted} />
  </g>;
}

const Folder = ({ x, y }: { x: number; y: number }) =>
  <path transform={`translate(${x} ${y})`} d="M0 6Q0 2 4 2h12l6 6h22q4 0 4 4v22q0 4-4 4H4q-4 0-4-4Z" className="fill-kh-bg-selected stroke-kh-primary" />;

const Arrow = ({ x, y }: { x: number; y: number }) => <path d={`M${x} ${y}h24m-5-5 5 5-5 5`} className="stroke-kh-primary" />;

const Panel = ({ x, y, width, height }: { x: number; y: number; width: number; height: number }) =>
  <rect x={x} y={y} width={width} height={height} rx="6" className="fill-kh-bg stroke-kh-border-strong" />;

/** The marks a sync's rows carry, centred on (x, y): "+" for a file it adds, a dot for one it changes. */
const Added = ({ x, y }: { x: number; y: number }) => <path d={`M${x - 3} ${y}h6m-3-3v6`} className="stroke-kh-success" />;
const Changed = ({ x, y }: { x: number; y: number }) => <circle cx={x} cy={y} r="1.5" className="fill-kh-primary stroke-kh-primary" />;

/**
 * The two ways to a first document, side by side in the order the buttons below offer them: a folder
 * becomes a document that is read-only here (the lock), or a pencil writes one that stays editable.
 */
function Start({ importFirst }: { importFirst: boolean }) {
  // Lanes are drawn from x 0, each mark 4 short of its arrow: the import lane is 119 wide, the write lane 98. Each sits 12 from the hairline,
  // which reads as "or" so the two are never taken for one flow, and the pair is centred on the canvas.
  const [left, right] = importFirst ? [119, 98] : [98, 119];
  const start = (256 - left - right - 24) / 2;
  const divider = start + left + 12;
  const imported = <g key="import" transform={`translate(${importFirst ? start : divider + 12} 0)`}>
    <Folder x={0} y={29} /><Arrow x={52} y={48} /><Doc x={80} y={29} />
    <circle cx="110" cy="64" r="9" className="fill-kh-bg stroke-kh-border-strong" />
    <rect x="106" y="63" width="8" height="6" rx="1" className="fill-kh-bg-selected stroke-kh-text-muted" /><path d="M107.5 63v-2a2.5 2.5 0 0 1 5 0v2" className="stroke-kh-text-muted" />
  </g>;
  const written = <g key="write" transform={`translate(${importFirst ? divider + 12 : start} 0)`}>
    <path d="M0 66v-7l20-20 7 7-20 20zM16 43l7 7" className="fill-kh-bg-selected stroke-kh-primary" /><Arrow x={31} y={48} /><Doc x={59} y={29} accent />
    <circle cx="89" cy="64" r="9" className="fill-kh-bg stroke-kh-primary" />
    <path d="M85 68l1-3.5 5.5-5.5 2.5 2.5-5.5 5.5z" className="stroke-kh-primary" />
  </g>;
  // The hairline spans the drawings' height: document top (29) to badge bottom (73).
  return <>{imported}<path d={`M${divider} 28v46`} className="stroke-kh-border-strong" />{written}</>;
}

function drawing(kind: Kind, importFirst: boolean) {
  switch (kind) {
    case "start": return <Start importFirst={importFirst} />;
    // Folder, then a Preview listing what will change (+ added, • changed), then the applied document.
    case "sources": return <>
      <Folder x={18} y={14} /><text x="42" y="40" textAnchor="middle" stroke="none" className="fill-kh-primary text-caption">.md</text>
      <Arrow x={74} y={33} />
      <Panel x={106} y={14} width={52} height={38} />
      <Added x={116} y={24} /><Changed x={116} y={33} /><Added x={116} y={42} />
      <path d="M124 24h24M124 33h18M124 42h22" className={muted} />
      <Arrow x={166} y={33} />
      <Doc x={198} y={14} accent />
      <circle cx="228" cy="49" r="9" className="fill-kh-bg stroke-kh-primary" /><path d="M224 49l3 3 5-6" className="stroke-kh-primary" />
      <g stroke="none" className="fill-kh-text text-caption" textAnchor="middle"><text x="42" y="76">Local folder</text><text x="132" y="76">Preview</text><text x="214" y="76">Apply</text></g>
    </>;
    case "search": return <>
      <Panel x={24} y={12} width={208} height={24} /><circle cx="40" cy="24" r="5" className="stroke-kh-primary" /><path d="M44 28l3 3M58 24h90" className={muted} />
      {/* The accent segment is the phrase found, in the result it opens. */}
      <Doc x={32} y={46} accent /><path d="M78 56h110M78 66h36M158 66h66M78 76h74" className={muted} /><path d="M120 66h32" className="stroke-kh-primary" />
    </>;
    // Your document, through a link, to someone else's screen: the person on the badge is who reads it.
    case "shares": return <>
      <Doc x={20} y={29} accent /><Arrow x={60} y={48} />
      <Panel x={92} y={34} width={64} height={28} />
      <path transform="translate(98 36)" d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" className="stroke-kh-primary" />
      <path d="M128 48h20" className={muted} />
      <Arrow x={164} y={48} /><Doc x={196} y={29} />
      <circle cx="226" cy="64" r="9" className="fill-kh-bg stroke-kh-border-strong" />
      <circle cx="226" cy="61.5" r="2.5" className="stroke-kh-text-muted" /><path d="M221.5 69a4.5 4.5 0 0 1 9 0" className="stroke-kh-text-muted" />
    </>;
    case "insights": return <>
      <Panel x={24} y={10} width={208} height={76} /><path d="M40 28h39M40 39h24M40 60h60M40 71h44M136 74h78" className={muted} />
      {[{ x: 141, y: 56 }, { x: 165, y: 40 }, { x: 189, y: 26 }].map(({ x, y }) => <rect key={x} x={x} y={y} width="14" height={74 - y} rx="2" className="fill-kh-bg-selected stroke-kh-primary" />)}
    </>;
    case "updates": return <>
      <Doc x={36} y={29} /><Arrow x={82} y={48} />
      <Panel x={118} y={14} width={104} height={68} /><Added x={134} y={30} /><Changed x={134} y={48} /><Added x={134} y={66} /><path d="M144 30h60M144 48h44M144 66h52" className={muted} />
    </>;
    case "graph": return <>
      {/* Links first, so the opaque documents hide their ends. */}
      <path d="M80 19L47 76H113L80 19" className="stroke-kh-primary" />
      <path d="M31 20V28M27 24H35M134 36V42M131 39H137" className="stroke-kh-primary" opacity="0.45" />
      <Doc x={64} y={0} accent /><Doc x={31} y={57} accent /><Doc x={97} y={57} accent /><Doc x={193} y={29} />
    </>;
    // Chosen documents become Markdown (the heading mark) for the agent.
    case "context": return <>
      <Panel x={11} y={18} width={60} height={60} />
      {[32, 48, 64].map((y, index) => <g key={y}>
        <rect x="21" y={y - 5} width="10" height="10" rx="2" className={index < 2 ? "fill-kh-bg-selected stroke-kh-primary" : "stroke-kh-border-strong"} />
        {index < 2 ? <path d={`M23 ${y}l2 2 4-4`} className="stroke-kh-primary" /> : null}
        <path d={`M39 ${y}h24`} className={muted} />
      </g>)}
      <Arrow x={77} y={48} />
      <Panel x={107} y={18} width={52} height={60} />
      <path d="M122 25l-1 8M126 25l-1 8M119.5 27.5h8M119 30.5h8" className="stroke-kh-primary" /><path d="M133 29h18M120 41h31M120 49h24M120 61h31M120 69h20" className={muted} />
      <Arrow x={165} y={48} />
      {/* The agent: the Copy for Agent action's robot (antenna, rounded head, ears), drawn friendlier at this size. */}
      <circle cx="220" cy="24" r="3" className="fill-kh-bg-selected stroke-kh-primary" /><path d="M220 27v9" className="stroke-kh-primary" />
      <rect x="193" y="47" width="5" height="12" rx="2.5" className="fill-kh-bg-selected stroke-kh-primary" /><rect x="242" y="47" width="5" height="12" rx="2.5" className="fill-kh-bg-selected stroke-kh-primary" />
      <rect x="198" y="36" width="44" height="34" rx="12" className="fill-kh-bg-selected stroke-kh-primary" />
      <circle cx="211" cy="51" r="2.5" className="fill-kh-primary stroke-kh-primary" /><circle cx="229" cy="51" r="2.5" className="fill-kh-primary stroke-kh-primary" />
      <circle cx="205" cy="58" r="2.5" stroke="none" className="fill-kh-primary" opacity="0.25" /><circle cx="235" cy="58" r="2.5" stroke="none" className="fill-kh-primary" opacity="0.25" />
      <path d="M215 58q5 4.5 10 0" className="stroke-kh-primary" />
    </>;
    case "reading": return <>
      {/* The page names where it came from: a folder and its path, above the document. */}
      <Panel x={56} y={12} width={144} height={72} />
      <path d="M72 19.5q0-1.5 1.5-1.5h4l2 2h6q1.5 0 1.5 1.5v4q0 1.5-1.5 1.5h-12q-1.5 0-1.5-1.5Z" className="fill-kh-bg-selected stroke-kh-primary" /><path d="M93 20l2.5 2.5L93 25M101 22.5h28" className={muted} />
      <Doc x={72} y={36} accent />
      <path d="M116 41h64" className="stroke-kh-text" /><path d="M116 51h44" className="stroke-kh-primary" /><path d="M116 65h68M116 75h52" className={muted} />
    </>;
  }
}

/** A small illustrative example: never a projection of workspace data, and hidden from assistive technology. */
export function Illustration({ kind, importFirst = true }: { kind: Kind; importFirst?: boolean }) {
  return <svg data-illustration={kind} viewBox="0 0 256 96" className="h-24 w-64 max-w-full" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {drawing(kind, importFirst)}
  </svg>;
}
