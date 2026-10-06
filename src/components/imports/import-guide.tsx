import Link from "next/link";
import type { GuideBlock, GuideContent, GuideLocale } from "./import-guide-content";

const LANGUAGES: { locale: GuideLocale; label: string }[] = [
  { locale: "en", label: "English" },
  { locale: "zh-TW", label: "繁體中文" },
];

const LINK = "w-fit rounded-md text-body font-medium text-kh-text-muted underline-offset-4 hover:underline kh-focus-ring";

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
        <div className="mt-2 overflow-x-auto">
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

/** The guide page body: language switch, content in its own `lang`, and the way back to the form. */
export function ImportGuide({
  workspaceId,
  locale,
  content,
}: {
  workspaceId: string;
  locale: GuideLocale;
  content: GuideContent;
}): React.JSX.Element {
  const guideHref = `/w/${workspaceId}/sources/import/guide`;
  return (
    <main className="kh-page py-6">
      <Link className={LINK} href={`/w/${workspaceId}/sources/import`}>Back to Import folder</Link>
      <nav aria-label="Guide language" className="mt-3 flex flex-wrap items-center gap-3 text-body">
        {LANGUAGES.map((language) => (
          <Link
            key={language.locale}
            href={`${guideHref}?lang=${language.locale}`}
            lang={language.locale}
            aria-current={language.locale === locale ? "page" : undefined}
            className={`rounded-md underline-offset-4 hover:underline kh-focus-ring ${language.locale === locale ? "font-semibold text-kh-text" : "text-kh-link"}`}
          >
            {language.label}
          </Link>
        ))}
      </nav>
      <div lang={locale} className="mt-4 max-w-reading">
        <h1 className="text-heading font-semibold text-kh-text">{content.title}</h1>
        <p className="mt-1 text-body text-kh-text-muted">{content.intro}</p>
        {content.sections.map((section) => (
          <section key={section.id} id={section.id} aria-labelledby={`${section.id}-heading`} className="mt-6">
            <h2 id={`${section.id}-heading`} className="text-title font-semibold text-kh-text">{section.title}</h2>
            {section.body.map((block, index) => <Block key={index} block={block} caption={section.title} />)}
          </section>
        ))}
      </div>
      <p className="mt-6 text-body">
        <Link className="rounded-md font-medium text-kh-link underline-offset-4 hover:underline kh-focus-ring" href={`/w/${workspaceId}/sources/import#sample-wiki`}>
          Try the sample wiki
        </Link>
      </p>
    </main>
  );
}
