import type { GuideBlock } from "./import-guide-content";

/** A `backtick span` in the content is inline code; everything else is text. */
function Inline({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {text.split("`").map((part, index) =>
        index % 2 === 1 ? (
          <code key={index} className="rounded-sm bg-kh-bg-subtle px-1 py-0.5 font-mono text-body-sm">{part}</code>
        ) : (
          part
        ),
      )}
    </>
  );
}

function Block({ block, caption }: { block: GuideBlock; caption: string }): React.JSX.Element {
  switch (block.kind) {
    case "p":
      return <p className="mt-2 text-body text-kh-text-secondary"><Inline text={block.text} /></p>;
    case "note":
      return <p className="mt-2 rounded-md border-l-2 border-kh-primary bg-kh-bg-subtle px-3 py-2 text-body font-medium text-kh-text"><Inline text={block.text} /></p>;
    case "ul":
    case "ol": {
      const List = block.kind;
      return (
        <List className={`mt-2 space-y-1 pl-5 text-body text-kh-text-secondary ${block.kind === "ol" ? "list-decimal" : "list-disc"}`}>
          {block.items.map((item) => <li key={item}><Inline text={item} /></li>)}
        </List>
      );
    }
    case "code":
      return <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-md border border-kh-border bg-kh-bg-subtle px-3 py-2 font-mono text-body-sm text-kh-text">{block.text}</pre>;
    case "table":
      return (
        <div className="relative mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-left text-body">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr className="text-caption text-kh-text-muted">
                {block.head.map((cell) => <th key={cell} scope="col" className="border-b border-kh-border bg-kh-bg-subtle px-3 py-2 font-medium">{cell}</th>)}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row[0]} className="border-b border-kh-border last:border-b-0">
                  <th scope="row" className="px-3 py-2 font-medium text-kh-text">{row[0]}</th>
                  {row.slice(1).map((cell, index) => <td key={index} className="px-3 py-2 text-kh-text-secondary"><Inline text={cell} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export {Block as GuideContentBlock};
