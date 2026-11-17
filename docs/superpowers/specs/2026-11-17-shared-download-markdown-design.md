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

## Non-goals

- A ZIP of a whole shared folder or Source. That needs a new caller-less read by token; it gets its
  own spec if it is wanted later.
- YAML frontmatter. The ordinary export (`/api/documents/:id/export`) writes the revision's metadata
  as frontmatter. The shared views do not carry metadata, and this change does not add it.

## Anti-goals

- No new route, no new caller-less entry, nothing served that the page does not already serve. The
  share-link invariants in `CLAUDE.md` and `tests/unit/share-link-single-exception.test.ts` stay as they are.

## Approaches

1. **Client-side from the page's own data (chosen).** The page already passes the current revision's
   `title` and `markdown` to `SharedReviewPanel`. A small client button calls the existing
   `downloadMarkdown(title, markdown)` (`src/lib/download-markdown.ts`). It grants nothing new.
2. **A token-scoped export route plus a ZIP for folders.** This would add whole-folder export, at the
   cost of a new caller-less entry, a spec and an exception-list change. Not chosen; see non-goals.
3. **ZIP only on folder pages.** Readers who want a single document lose out. Rejected.

## Design

- `src/components/knowledge/shared-download-button.tsx` (client): a ghost button with the `Download`
  icon and the label "Download". On a phone only the icon shows, with its full name kept for screen
  readers, matching the Save and Open buttons.
- It sits in each page's `actions`, before Save. The Hub reader passes no `actions` today; there it is
  the only action.
- File content: the revision's Markdown exactly as served. File name: the title, sanitised by
  `downloadMarkdown`.

## Testing

- An e2e test on a document link and a folder link checks that the downloaded file's name is the
  title plus `.md` and that its content equals the current revision's Markdown.

## Left to the builder

- Exact placement within the bar and the e2e file name.
