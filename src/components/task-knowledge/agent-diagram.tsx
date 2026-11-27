const READ = "var(--kh-success)";
const WRITE = "var(--kh-primary)";

/**
 * What an AI agent can reach, drawn: the agent and the `knowledge-hub` command, with the binding token, on the
 * reader's machine; My Space inside Knowledge Hub. Read and Write say what crosses between them. Agents cannot
 * edit documents, so Documents reads only. Colours are the page's own tokens, so it follows light and dark.
 */
export function AgentDiagram() {
  return (
    <figure className="rounded-lg border border-kh-border bg-kh-bg-subtle p-3">
      <svg viewBox="0 0 640 190" width="100%" role="img" aria-label="On your machine, an AI agent runs the knowledge-hub command, which holds a binding token. Through the binding it reads documents and task results in My Space on Knowledge Hub, and writes task results." className="block fill-kh-text-muted text-kh-text" fontFamily="inherit" fontSize="12">
        <defs>
          <marker id="agent-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0L8 4L0 8z" fill="context-stroke" />
          </marker>
        </defs>
        <g className="fill-none stroke-kh-border-strong" strokeDasharray="4 4"><rect x="4" y="4" width="290" height="182" rx="10" /><rect x="346" y="4" width="290" height="182" rx="10" /></g>
        <text x="16" y="24">On your machine</text>
        <text x="358" y="24">Knowledge Hub</text>
        <g className="fill-kh-bg stroke-kh-border">
          <rect x="16" y="40" width="120" height="40" rx="6" /><rect x="16" y="90" width="120" height="40" rx="6" />
          <rect x="168" y="52" width="118" height="96" rx="8" /><rect x="370" y="40" width="254" height="134" rx="8" />
        </g>
        <g className="fill-kh-bg-subtle"><rect x="177" y="106" width="100" height="30" rx="6" /><rect x="382" y="70" width="230" height="46" rx="6" /><rect x="382" y="122" width="230" height="44" rx="6" /></g>
        <g fontSize="13" className="fill-kh-text">
          <text x="28" y="64">Claude Code</text><text x="28" y="114">OpenCode</text>
          <text x="177" y="74" fontWeight="500">knowledge-hub</text>
          <text x="394" y="90">Documents</text><text x="394" y="141">Task results</text>
        </g>
        <text x="16" y="152" fontSize="11">AI agent, runs a skill</text>
        <text x="177" y="92" fontSize="11">command</text>
        <text x="187" y="125" fontSize="11" className="fill-kh-text-secondary">binding token</text>
        <text x="382" y="60">My Space</text>
        <g fontSize="11" fontWeight="500">
          <text x="394" y="107" fill={READ}>Read</text>
          <text x="394" y="158" fill={READ}>Read</text><text x="426" y="158">·</text><text x="436" y="158" fill={WRITE}>Write</text>
          <text x="300" y="86" fill={READ}>Read</text><text x="300" y="133" fill={WRITE}>Write</text>
        </g>
        <g className="fill-none stroke-kh-text-muted" strokeWidth="1">
          <path d="M136 60 L152 60 L152 85 L166 85" markerEnd="url(#agent-arrow)" /><path d="M136 110 L152 110 L152 85" />
        </g>
        <line x1="370" y1="93" x2="288" y2="93" stroke={READ} markerEnd="url(#agent-arrow)" />
        <line x1="288" y1="140" x2="368" y2="140" stroke={WRITE} markerEnd="url(#agent-arrow)" />
      </svg>
      <figcaption className="mt-1.5 text-caption text-kh-text-muted">Runs only when you type a skill. Agents cannot edit documents, and reach only this My Space.</figcaption>
    </figure>
  );
}
