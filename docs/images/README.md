# README screenshot provenance

These screenshots were freshly captured on **2026-10-05 (Asia/Taipei)** from a production build after fetching and fast-forwarding to remote main [`3739efb12906e1cb2e6abc1b5eea7727914a08ab`](https://github.com/mike840609/knowledge-hub/commit/3739efb12906e1cb2e6abc1b5eea7727914a08ab). They replace the October 2 screenshots formerly used by the main README.

- Build ID: `p61B410H6oSgHi5044IHC`; `npm run build` passed, including lint and type validation.
- Runtime: `next start`, bound to loopback only. Local test identity was enabled for this screenshot session; this is not a production deployment configuration.
- Application components and tests match this main commit. The only local source change is `src/app/layout.tsx`, which changes the browser title and description to organization-neutral text; it does not alter the rendered page layout.
- Account: **Documentation Demo**, a dedicated local persona. All four documents were created as synthetic English examples; no existing personal notes were used.
- Viewport: 767 × 951, light theme, responsive layout. Captures are unedited browser JPEGs.
- Pages checked: Home, the Engineering handbook reader, source detail/history, and Graph. Content rendered, navigation worked, and no framework error overlay was present. One React hydration warning (#418) was recorded during the session; this is a known observation, not a claim of a warning-free browser check.

| Image | Content |
| --- | --- |
| `personal-home.jpg` | My Space overview, one synced folder, unread updates and a personal note |
| `document-reader.jpg` | Synthetic handbook, expanded table of contents, wikilinks and backlinks |
| `source-history.jpg` | Source-managed folder overview and successful import history |
| `knowledge-graph.jpg` | Four documents connected by five links |

[Machine-readable capture metadata](capture.json) records the commit, build ID, viewport and SHA-256 of each image. The historical before/after images under `docs/ui-comparisons/` are separate evidence from the original feature PRs; they are not the main README's current captures.

For replacements, fetch main again, build that checkout, use a dedicated synthetic account, wait for content to finish rendering, inspect every image, and update both READMEs and the metadata. These screenshots are project documentation covered by the repository license.
