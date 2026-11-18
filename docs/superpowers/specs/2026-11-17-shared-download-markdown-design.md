# Download Markdown on shared pages — design

Date: 2026-11-17. Size: small change.

## Intent

A reader of a shared page can take the document they are reading away as a `.md` file, as a
signed-in reader of an ordinary document page can with **Download Markdown**.

## Goals

- A **Download Markdown** button on every page that reads a share link:
  - `/s/:token`: document, folder and Source links;
  - `/w/<ws>/shares/:token`: the Hub's named-share reader, both the document and folder forms.
- On a folder or Source page it downloads the document being read (`?d=`), not the folder.
- The file is the ordinary export's file: YAML frontmatter (the revision's metadata plus the title),
  then the Markdown, built by the same `exportMarkdown()` (`src/lib/markdown-export.ts`).

## Non-goals

- A ZIP of a whole shared folder or Source. That needs a new caller-less read by token; it gets its
  own spec if it is wanted later.

## Anti-goals

- No new route and no new caller-less entry. `readShared` stays the one entry that serves a document;
  `tests/unit/share-link-single-exception.test.ts` is unchanged.

## Recorded change to what a link serves

A share link now also serves the current revision's **metadata** (the author's frontmatter), which
before it did not. It is the same revision the link already opens, to the same callers, judged the same
way, so the grant is no wider; only the content served grows. Frontmatter fields that the reader never
showed (for example `tags`, `owner` or a custom key) are now readable by anyone holding the link.
Chosen by the user on 2026-11-17 so that a shared download matches the ordinary one.
Review mentions, saved shares and `queryForLink` are unaffected: they never serve metadata.

## Approaches

1. **Client-side from the page's own data (chosen).** The page already passes the current revision's
   `title` and `markdown` to `SharedReviewPanel`. `SharedDocumentView` gains `metadata`, set in
   `readShared` for the document view and both folder/Source views. A small client button calls the
   existing `downloadMarkdown(title, exportMarkdown({ title, markdown, metadata }))`. Frontmatter
   (乙) was chosen over a body-only file (甲), which would have served nothing new.
2. **A token-scoped export route plus a ZIP for folders.** This would add whole-folder export, at the
   cost of a new caller-less entry, a spec and an exception-list change. Not chosen; see non-goals.
3. **ZIP only on folder pages.** Readers who want a single document lose out. Rejected.

## Design

- `src/components/knowledge/shared-download-button.tsx` (client): a ghost button with the `Download`
  icon and the label "Download". On a phone only the icon shows, with its full name kept for screen
  readers, matching the Save and Open buttons.
- It sits in each page's `actions`, before Save. The Hub reader passes no `actions` today; there it is
  the only action.
- File content: `exportMarkdown()` output, byte-identical to `/api/documents/:id/export` for the same
  revision. File name: the title, sanitised by `downloadMarkdown`.

## Testing

- Unit: `readShared` returns the current revision's metadata for document, folder and Source views.
- E2e on a document link and a folder link: the file is named after the title plus `.md`, and its
  content equals the ordinary export of the same revision, frontmatter included.

## Left to the builder

- Exact placement within the bar and the e2e file name.
