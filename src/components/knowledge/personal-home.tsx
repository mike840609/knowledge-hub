"use client";
import Link from "next/link";
import { FileText, PenLine, Star } from "lucide-react";
import { navigateListRows } from "@/lib/list-row-navigation";
import { useDocumentShortcuts, documentShortcutKey } from "./use-document-shortcuts";
import { toggleFavoriteDocument } from "@/lib/document-shortcuts";
import { Button, buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/shell/page-header";
import { Timestamp } from "@/components/ui/timestamp";
import { Tooltip } from "@/components/ui/tooltip";
import { useHydrated } from "@/components/shell/use-hydrated";

type Doc = { documentId: string; sourceId: string; title: string; updatedAt: string };
type Draft = { key: string; title: string; sourceId: string | null; updatedAt: string };

/**
 * A group on this page is a label and a list of rows, nothing between them.
 * The label is the one style the rails use for theirs (§8): `caption`, medium,
 * `text-muted`, so a heading never competes with the rows beneath it.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="px-3 pb-1 text-caption font-medium text-kh-text-muted">{title}</h2>
      {children}
    </section>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-2 text-body text-kh-text-muted">{children}</p>;
}

/**
 * One row, and the whole row is the link — as `SourceListRow` and the search
 * results are. The favourite toggle sits beside the link rather than inside
 * it, so it is its own target and a click on it never navigates.
 */
function Row({ href, icon, title, updatedAt, trailing }: {
  href: string;
  icon: React.ReactNode;
  title: string;
  updatedAt: string;
  trailing?: React.ReactNode;
}) {
  return (
    <li className="kh-interactive-row group flex min-h-10 items-center pr-1">
      <Link
        data-list-row
        href={href}
        className="kh-focus-ring flex min-h-10 min-w-0 flex-1 items-center gap-3 rounded-md px-3"
      >
        <span className="shrink-0 text-kh-text-muted">{icon}</span>
        <span className="min-w-0 flex-1 truncate text-body font-medium text-kh-text">{title}</span>
        <Timestamp value={updatedAt} variant="date" className="shrink-0 text-caption text-kh-text-muted" />
      </Link>
      {trailing}
    </li>
  );
}

export function PersonalHome({ workspaceId, documents, drafts }: { workspaceId: string; documents: Doc[]; drafts: Draft[] }) {
  const { shortcuts, update } = useDocumentShortcuts(workspaceId);
  const hydrated = useHydrated();
  const keyOf = (doc: Doc) => documentShortcutKey(doc.sourceId, doc.documentId);
  const favorites = documents.filter((doc) => shortcuts.favorites.includes(keyOf(doc)));
  const recent = shortcuts.recent
    .map((key) => documents.find((doc) => keyOf(doc) === key))
    .filter((doc): doc is Doc => !!doc);

  function documentRows(docs: Doc[]) {
    return (
      <ul onKeyDown={navigateListRows} className="space-y-0.5">
        {docs.map((doc) => {
          const key = keyOf(doc);
          const favorite = shortcuts.favorites.includes(key);
          const label = `${favorite ? "Remove favorite" : "Favorite"}: ${doc.title}`;
          return (
            <Row
              key={key}
              href={`/w/${workspaceId}/knowledge/${doc.sourceId}/${doc.documentId}`}
              icon={<FileText size={14} aria-hidden="true" />}
              title={doc.title}
              updatedAt={doc.updatedAt}
              trailing={
                <Tooltip label={favorite ? "Remove from favorites" : "Add to favorites"}>
                  <Button
                    variant="ghost"
                    icon
                    size="sm"
                    disabled={!hydrated}
                    onClick={() => update((state) => toggleFavoriteDocument(state, key))}
                    aria-label={label}
                    className={favorite ? "text-kh-selected-text" : "kh-row-action"}
                  >
                    <Star size={14} fill={favorite ? "currentColor" : "none"} aria-hidden="true" />
                  </Button>
                </Tooltip>
              }
            />
          );
        })}
      </ul>
    );
  }

  return (
    <div className="kh-page space-y-6 py-6">
      <PageHeader
        location="My Space"
        locationHref={`/w/${workspaceId}/home`}
        title="Home"
        description="Continue writing, revisit a favorite, or start a note."
        actions={<Link className={buttonClasses()} href={`/w/${workspaceId}/knowledge/new`}>New note</Link>}
      />
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Link className={buttonClasses({ variant: "secondary" })} href={`/w/${workspaceId}/knowledge`}>Organize documents</Link>
          <a className={buttonClasses({ variant: "secondary" })} href={`/api/workspaces/${workspaceId}/export`}>Export Markdown ZIP</a>
        </div>
        <p className="text-caption text-kh-text-muted">
          Export includes saved documents and archived notes. Drafts, revision history and attachment files are excluded.
        </p>
      </div>
      <Section title="Drafts">
        {drafts.length ? (
          <ul onKeyDown={navigateListRows} className="space-y-0.5">
            {drafts.map((draft) => (
              <Row
                key={draft.key}
                href={draft.key === "draft:new"
                  ? `/w/${workspaceId}/knowledge/new`
                  : `/w/${workspaceId}/knowledge/${draft.sourceId}/${draft.key.split(":")[1]}/edit`}
                icon={<PenLine size={14} aria-hidden="true" />}
                title={draft.title || "Untitled draft"}
                updatedAt={draft.updatedAt}
              />
            ))}
          </ul>
        ) : <EmptyLine>No unfinished drafts.</EmptyLine>}
      </Section>
      {recent.length > 0 && <Section title="Continue reading">{documentRows(recent.slice(0, 4))}</Section>}
      <Section title="Favorites">
        {favorites.length ? documentRows(favorites) : <EmptyLine>Star a document to keep it here across devices.</EmptyLine>}
      </Section>
      <Section title="Recently edited">
        {documents.length ? documentRows(documents.slice(0, 12)) : (
          <EmptyLine>
            Create your first note or <Link className="rounded-md text-kh-link underline underline-offset-2 kh-focus-ring" href={`/w/${workspaceId}/sources/import`}>import a folder</Link>.
          </EmptyLine>
        )}
      </Section>
    </div>
  );
}
