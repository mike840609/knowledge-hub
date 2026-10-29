# README screenshot provenance

These screenshots were captured on **2026-10-29 (Asia/Taipei)** from a production build of commit [`ba699b4e37ed5fdc22f3633e468aff6ef5a1704d`](https://github.com/mike840609/knowledge-hub/commit/ba699b4e37ed5fdc22f3633e468aff6ef5a1704d). They replace the October 5 screenshots that showed the earlier shell.

- Build ID: `7aWv1H9ksnG-Cg6MbGbmL`; `npm run build` passed, including lint and type validation.
- Runtime: `next start`, bound to loopback only. The build used the separate `.next-demo` output directory so it could run beside the development server. Local test identity was enabled for this screenshot session; this is not a production deployment configuration.
- Application source matches the commit above. The only local change is the separate build output directory; it does not alter the rendered UI. The later Inbox split view and users-account changes do not touch the pictured pages.
- Account: **Documentation Demo**, a dedicated local persona. The workspace contains the bundled English sample wiki (`public/sample-wiki/en`) and three synthetic personal notes. No existing personal notes or real content were used.
- Viewport: **1440 × 900**, light theme, compact density, desktop layout. Captures are unedited browser JPEGs at quality 90.
- Layout: the 176px primary rail and the inline Knowledge explorer are visible at this width. Below 1280px the explorer becomes a drawer; below 1024px the primary navigation moves into the Menu drawer.
- Pages checked: Home, the Leave policy reader, Search, the Sample wiki source detail/history, and Graph. Content rendered, navigation worked, and no framework error overlay was present. One RSC prefetch request returned 404 during a navigation; every page still rendered and no user-facing error appeared.

| Image | Content |
| --- | --- |
| `personal-home.jpg` | Home with Recent documents, Discussions, Favorites, Search, and New note |
| `document-reader.jpg` | The Leave policy document with the explorer, outline, resolved links, backlinks, and the read-only cue for a synced source |
| `search.jpg` | Search results for `leave`, with source and original path shown for each match |
| `source-history.jpg` | The Sample wiki source detail with ownership, document count, import history, and the Update from folder control |
| `knowledge-graph.jpg` | Ten documents connected by seventeen links, with orphan nodes hidden |

[Machine-readable capture metadata](capture.json) records the commit, build ID, viewport, account, and SHA-256 of each image. The historical before/after images under `docs/ui-comparisons/` are separate evidence from feature PRs; they are not the main README's current captures.

For replacements, use a dedicated synthetic account and the bundled sample wiki, build production output, wait for content to finish rendering, inspect every image, and update both READMEs and the metadata. These screenshots are project documentation covered by the repository license.
