# Personal daily-driver package, first batch — design specification

> 2026-09-30 update: the Team flag originally restricted only the switcher. The later [Personal workspace rollout](2026-09-30-personal-workspace-design.md) adds server-side personal-only authorization. Organization/archive are complete on main; subsequent account favorites, drafts, export, revision restore, and Home behavior follow that rollout specification.

| Item | Content |
| --- | --- |
| Date | 2026-09-29 |
| Status | Five open questions decided 2026-09-29 (§12); implementation not yet started at this document's initial state |
| Scope | Everyday Personal workspace: rendered-editor wikilink integrity (slice 0), code blocks (C), `[[` completion/create from unresolved (D), organization/archive web entry (A), palette recents and sidebar Show all favorites (B.0). Server favorites B.1–B.4 are **excluded from this batch**. |
| Prerequisites | [Links/graphs](2026-09-29-personal-workspace-knowledge-graph-design.md) #78, [composer](2026-09-28-document-composer-design.md) #62, [action model](2026-09-21-action-model-spec.md), [design language](frontend-design-language.md) |
| Plan | [`plans/2026-09-29-personal-daily-driver.md`](../plans/2026-09-29-personal-daily-driver.md) |

## 1. Verified current state

Read source before planning. A previous recommendation incorrectly described Favorites, so each inventory row records evidence instead of impressions.

| Item | Current state | Evidence |
| --- | --- | --- |
| Folders/move/order/archive/restore | **Backend complete, no web entry** | HubKnowledgeCommandService has createFolder/renameFolder/moveTreeNode/reorderTreeNode/archive*/restore*, single transactions locking Source, requiring HUB_MANAGED, rejecting cycles/cross-source moves. Web API calls only createDocument/createRevision; registry lacks these actions; no drag tree. |
| New document location | Default Hub Source root | POST workspace documents hard-codes parentId:null |
| Favorites/Recents | **Existing, browser-local** | use-document-shortcuts → localStorage per workspace; sidebar sections, stars, row/palette toggles. Store8/show4 each; empty palette has no recents. |
| Code blocks | No highlight or Copy | No highlighter dependency; ScrollablePre only wraps |
| Export | None | No export route or Content-Disposition |
| Images | Relative/same-origin only; no storage | markdown-image-policy, CSP img-src self |
| Rendered wikilinks | **Broken, D0** | Below |

### 1.1 D0: rendered mode escapes wikilinks

Composer defaults to Milkdown rendered editing. Open, edit one character, serialize:

| Input | Output | Indexed links |
| --- | --- | --- |
| `See [[Target Note]] for details.` | `See \[\[Target Note]] for details. edited` | 1 → **0** |
| `[[Note\|alias]]`, `[[Note#Setup]]` | Both become `\[\[…]]` | 2 → **0** |
| `- item with [[Item Link]]` | `- item with \[\[Item Link]]` | 1 → **0** |
| `[the setup](./setup.md#local)` | Unchanged | Retained |

Consequences:

- Saving any wikilink document in rendered mode turns links into text and removes backlinks/graph edges.
- Typing `[[X]]` in a new rendered document saves escaped text. **Only source mode currently creates wikilinks.**
- Standard Markdown `[text](note.md)` remains intact.

**Missed by tests:** #62 and #78 were correct independently. Rebase of #78 onto #62 switched three E2E specs to source-mode creation, avoiding rendered mode entirely. §11 therefore requires rendered-mode editor tests.

**Not fixable with stringify settings:** remark turns raw `[[x]]` and intentionally escaped `\[\[x\]\]` into the same text value. Recognize syntax during parsing with a dedicated wikilink node (slice 0).

## 2. Goals and non-goals

**Goal:** everyday writing, linking, organizing, finding, and code reading work on the web without switching to source merely to use a feature.

**Deferred to later batches:** images/screenshots (storage and new authorization surface require specification), Mermaid, templates/daily notes, tags/frontmatter display, export/editable import, revision diff, link-rewriting rename, hover previews, properties, drag organization.

## 3. Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | **Slice0 first, separate hotfix PR** | Data integrity; D depends on it; do not delay behind features |
| D2 | Dedicated inline node, not stringify options | Parsing loses distinction (§1.1) |
| D3 | Existing findWikiLinks(node,markdown), preserve **raw string**, output intact | Third consumer alongside extraction/rendering, sharing rules |
| D4 | Server lowlight via custom rehype (§5), **explicit languages only**, no detection | Originally rehype-highlight, changed in C.7. Measured no lowlight in80 client files, present server-side. Detection slow/inaccurate; shiki≈600KB/asynchronous. Earlier npm unpacked-size figures are not bundle sizes and are not reused. |
| D5 | New light/dark --kh-syntax-* CSS variables | Color-layer contract; update token document together |
| D6 | Copy button independent client island, **no toast dependency** | Shared pages have no shell; useToast throws |
| D7 | Fetch workspace titles on first trigger, cap5000; filter/sort client-side | Immediate, one request, no per-key request; planned server fallback beyond cap |
| D8 | Rendered completion first; textarea later | Different cursor/popup implementation, lower value |
| D9 | `/knowledge/new?title=…&from=<documentId>`, writable users only | Existing create; from defines Cancel via ID, not arbitrary URL |
| D10 | Menu Move and keyboard ordering first, drag later | Complete accessible alternative retained even with drag |
| D11 | “Delete” means **archive**, reversible toast, no hard delete | ACTIVE/ARCHIVED invariant and reliable undo |
| D12 | Account favorites, local recents; **defer server migration**, B.0 only | Favorites follow users; history may stay browser-local; single-browser users unaffected (§12-1) |
| D13 | Every editor-affecting change requires rendered-mode test | §1.1 |

## 4. Slice 0: editor recognizes wikilinks

### 4.1 Behavior

1. **Parse:** remark plugin visits text using findWikiLinks, recognizing escapes/code/nesting. Replace recognized ranges with mdast wikiLink storing textual spelling including brackets with decoded escapes; preserve surrounding text. Intentionally escaped `\[\[x\]\]` stays text. **Share replaceWikiLinks traversal and excluded-node set with reading**, passing replacement-node builders rather than duplicating rules.
2. **Node:** ProseMirror inline **atom** wiki_link stores only **raw**. Compute target/fragment/alias via parseWikiLinkParts(raw) for display; duplicated attributes could diverge and spike shows computation suffices.
3. **Output:** preserve raw syntax using **custom mdast wikiLink/to-markdown handler**, not inline html. Spike (§4.4) found html emits unescaped table pipes and corrupts cells. Inspect state.stack/tableCell and restore `\|`. Configure handler in remarkStringifyOptionsCtx.handlers, not plugin extensions, because options override extension handlers.
4. **Input:** closing `]]` input rule creates node unless prefixed by !/backslash or inside code/link. transformPasted handles text containing syntax. **Correction:** Milkdown has no loaded clipboard plugin or Markdown paste processing; plain text otherwise remains text and serializes escaped. Inspect **destination**, not just pasted content: a paste inside a code block lacks its enclosing block in transformPasted, while end-of-inline-code lies outside a noninclusive mark, requiring stored-mark checks.
5. **Display:** existing link color/underline tokens, alias??target with `› fragment`, shared shownText; title shows raw. **Correction:** editor lacks catalog/draft resolution, so no click, including modifier-click, navigates. Clicking selects the atom; navigate in reader.
   Chromium observations: one Backspace directly after link deletes whole node, Ctrl+Z restores; click selects with background and stays on page. Arrow sequences sometimes select then cross and sometimes cross directly; **do not assert arrow behavior**.

### 4.2 Invariants and acceptance

- **Lossless round trip:** extract inline cases from document-links-extract.test.ts into shared Markdown fixtures, used by extractor and editor tests. Assert sorted extractDocumentLinks(original) equals extraction after editor round trip. Extractor rules define editor requirements.
- Intentionally escaped `\[\[x\]\]` stays escaped, not a link.
- Code/inline-code `[[x]]` stays unchanged.
- Rendered E2E: edit/save a wikilink document, preserving source/backlinks; type Chinese fixture `[[目標]]`, save, and observe target backlink.

### 4.3 Existing damaged documents

Opening-only `\[\[X]]` is characteristic Milkdown output; intentional escapes generally include closing brackets (`\[\[X\]\]`). Use the signature for **detection** with a read-only dry-run-default report. **No repair in this batch:** revisions would change history; inspect actual counts first (§12-2). Script has no write option.

### 4.4 Spike findings, Task0.1, 2026-09-29

In jsdom, mount draft remark/wiki_link through createMarkdownEditor extraPlugins/configure: findWikiLinks splitting, raw-only node, custom mdast output. For35 inputs, serialize on open and after one character at the first text block; compare extracted edges.

**Result:** all35 preserve edges. Without node, main loses all wikilink edges in31, adds an incorrect edge in literalBeforeImage (D0b), and leaves3 unaffected (insideLink, relative, starred, no wikilink or outside edited range). Coverage: ordinary/aliases/headings/both, lists/ordered/tasks, multiple, Chinese/paths/headings, quotes, bold/italic including sole bold link, tables/escaped pipes, block IDs, spaces, embeds, escapes, inline/fenced code, link-nested syntax, starred, multiline/nested, adjacent/boundaries, soft/hard breaks, images, entities. Existing48 markdown-editor tests pass because draft wiring is absent there; proves files do not break baseline, **not** that wiring leaves behavior unchanged.

| Assumption | Finding |
| --- | --- |
| Node preserves raw links | Confirmed |
| mdast html avoids escaping | Mostly, **but table aliases lose escaped pipe, split cell, edges1→0**. Custom wikiLink handler detects tableCell and restores pipe escape; passes. |

**Existing D0b unrelated to node:** Milkdown text handler returns text ending in space with no `*`, `_`, or backslash unchanged, without escaping. Main turns `\[\[lit\]\] and ![a](/a.png)` into `[[lit]] and ![a](/a.png)`, wrongly adding an edge. A wikilink node increases exposure because preceding text often ends in space; escaped literal plus Real behaves similarly. configureWikiLinkStringify wraps text handler only for `[[` text ending in whitespace, routing through safe and restoring trailing whitespace. Other text unchanged. Verify image-adjacent escaped literal and `[[A]] \[\[lit\]\] [[B]]` stay intact.

**Not proved by spike:**

- ProseMirror interaction: whole-node deletion, arrows, parseDOM/toDOM clipboard, input rules (0.4/0.5).
- Styling/title/light-dark (0.8).
- Real browser/composer saving (0.9 rendered E2E).
- Chunk-size difference.

**Plan effects:**

- 0.4 node has raw only.
- 0.6 wiring requires plugin/node **and** configureWikiLinkStringify for wikiLink/text handlers; either omission breaks round trips.
- Existing “a wikilink is escaped” test (`see [[Other Page]] here` → escaped output) records the defect. Change expectation after wiring, and mutation-test removing wiring restores old behavior (0.7).
- 0.2 shared fixtures add escaped table alias and escaped literal before image/between links.

## 5. Slice C: code blocks

- **Pipeline:** custom code-highlight.ts rehype directly uses lowlight for registered explicitly labeled fences, no guessing; unlabeled stays text. common plus dockerfile/groovy/protobuf; no extra languages (§12-5). hast→React, never innerHTML. **Deviation C.7:** rehype-highlight could not enforce the three limits below, including a full-page rendering defect; implement its required behavior directly and remove dependency.
- **Limits**, in characters including Markdown's added final newline: excess blocks remain plaintext, later blocks independently considered, no error.
  - **20000 characters/block.**
  - **100000/document**, spent on each attempt including depth-rejected output. Without total budget,200 blocks/1MB adds4.9s and4MB adds22.8s, per read, up to5MB MAX_MARKDOWN_BYTES, including anonymous shares. Budget reduces additions to0.42s/0.5s.
  - **Output nesting depth50.** Rust/Swift nested comments can create10000 span levels from repeated `/*` within character cap, overflowing renderer and preventing full document/share display. Measured3000 throws but5000 may not due to engine warmup; choose far below either. Real code depth is single digits.
  - Grammar exceptions also leave plaintext.
- **Measured C.7 cost:** real code≈5ms/KB;20KB runbook/10 blocks +86ms;20000-character C tables/INI/SQL/Python≈100ms. **Nonlinear case:** constructed numeric INI token5000→122ms,10000→488ms,19999→≈1.9s. Cap bounds worst block≈2s, at most≈5 such blocks/document budget. Tightening to10000 lowers worst≈0.5s by one constant. This trade-off was not asked in §12 and is recorded here.
- **Language audit C.1**, lowlight3.3.0/highlight.js11.11.2: common37 languages: `arduino bash c cpp csharp css diff go graphql ini java javascript json kotlin less lua makefile markdown objectivec perl php php-template plaintext python python-repl r ruby rust scss shell sql swift typescript vbnet wasm xml yaml`. dockerfile/groovy/protobuf are **not common**, but built into all192, no extra package; added aliases docker/proto. yml/sh/zsh/js/ts/py/kt/md/toml/jsonc are existing common aliases. Import individual highlight.js/lib/languages modules, never all192. Direct highlight.js dependency uses lowlight-compatible ~11.11 to avoid duplicates. **Stack gaps:** properties (Spring application.properties; available but not common), nginx/scala/gradle. Common INI/TOML is different syntax. ClickHouse uses sql; no dedicated grammar. §12-5 adds none; adding one is simple.
- **Colors:** globals.css defines --kh-syntax-{keyword,string,number,comment,function,type,variable,meta}, light/dark contrast≥4.5:1 on bg-subtle, with hljs rules in color layer and contract updates. **Outside @layer:** Tailwind removes runtime-only hljs classes not found in src. Measured components-layer compilation removed every rule despite normal source/unit checks. Test compiled stylesheet.
- **Copy:** persistent top-right ghost24px icon, aria-label=Copy code; on success checkmark and Copied for1.5s in polite live region. Copy **raw code**, no spans or Markdown-added final newline, retaining author newline. Clipboard rejection/insecure missing API shows Could not copy without throwing; works on share page without toast. **Deviation C.4:** click reads pre.textContent rather than carrying hast text as prop, same output without duplicated page payload. Button outside scrolling pre, stays fixed during long-line scrolling and visible for touch.
- **Scope:** reader/share, not rendered composer code (later ProseMirror decorations). Composer loading fallback also omits highlight/copy to resemble editor and keep lowlight out of client. Split MarkdownBase (layout) for composer MarkdownArticle and MarkdownRenderer (base+highlight/copy) for reader/share. composer-bundle.test.ts checks import closure. **Deviation:** plan C.5 claimed shared composer preview, contradicting this scope; this section prevails.
- **Acceptance:** unit registered/unlabeled/oversize languages and escaped script; E2E SQL token spans, exact raw clipboard, no share-page console errors.

## 6. Slice D: completion and create from unresolved

### 6.1 Rendered-editor completion

- **Trigger:** `[[` before cursor with query containing no `]`/newline, outside code, not preceded by backslash.
- **Data:** first GET workspace link-targets, initially planned array of documentId/sourceId/title/sourceName, only readable ACTIVE catalog entries with Source/Document/Tree all ACTIVE. cap5000, private/no-store; refresh at most once/60s. Client ranks prefix > substring > recent; normalizeLinkKey matches resolver so selected targets resolve.
- **Select:** arrows, Enter/Tab, Esc. Replace typed prefix with node; same-title choices remain title-only and resolver picks destination, Source disambiguates display. No match shows no-results, not create (see6.2).
- **Accessibility:** listbox/options; editor expanded/controls/active descendant; planned status announces N suggestions.

### 6.2 Create from unresolved

- For writable users with writable Hub Source, reader unresolved dashed span becomes new?title=target&from=currentID link. Inspector Unresolved and graph offer equivalent entry; others retain text.
- Creation reads initialTitle≤512; from must be UUID in same Workspace and only controls Cancel. Service rechecks authority; **URL inputs are navigation**.
- After creation, navigate normally; old source resolves at read time without rewriting.

### 6.3 Implementation record, 2026-09-30

Only decisions/deviations from above.

**Catalog and ranking**

- Actual response `{workspaceId, targets:[{documentId,sourceId,sourceName,title,editedAt}], truncated}` adds timestamp/cap notice. Membership authorization, uniform nonexistent/nonmember404. Titles only, no bodies (asserted). WHERE exactly matches loadCatalog's three ACTIVE states, with equality tests including independently archived document/tree rows; combined archive tests alone missed each condition's effect in mutation testing.
- Add **exact match** before prefix/substring/recent so Kubernetes precedes newer Kubernetes upgrade notes. Within levels editedAt then title/ID, deterministic; blank query sorts all by edits.
- Matching adds **NFKC** to normalizeLinkKey, finding fullwidth IME letters/numbers. Resolution itself does not fold fullwidth (`[[Ｋube]]` does not resolve Kube), safely because selection writes the actual title.
- Exclude titles that **do not resolve back to themselves** when serialized: pipes/hash create alias/fragment, slash requires sourcePath unavailable to Hub, md suffix is ignored, Markdown syntax splits nodes. Not a character blacklist: isWritableAsWikiLink in domain/wiki-link-title.ts extracts exactly one fragment/alias-free edge and resolves a single-document catalog to itself. Otherwise selection would produce another/unresolved destination.
- Keep all same-title documents with Source; resolver determines destination. sameTitle count is stored but unused in UI.
- Beyond5000 use most recently edited5000 and explicit `No match among the 5,000 most recently edited documents.` **No server-query fallback was implemented**; measurements in verification.
- Exclude the existing document being edited; self-links are unhelpful and recency would put it first.

**Trigger, keys, accessibility**

- Additional exclusions: preceding ! embed; close after |/# since target already selected; max query100 characters.
- Capture ↑/↓ cyclic, Enter/Tab, Esc **before editor keymap**, using handleKeyDown wrapping composer Enter rather than plugin keymap. Otherwise Enter splits list/Tab indents. Ignore IME isComposing/keyCode229, Meta/Ctrl/Alt, Shift+Enter/arrows. **Loading/empty lists do not consume Enter/Tab.** Esc stops propagation to composer leave, and suppresses the same trigger until cursor leaves/reenters or new trigger appears.
- Selection is separate undo step via closeHistory, restoring typed query rather than earlier whole typing.
- Open editor becomes combobox with expanded/controls/active descendant/haspopup=listbox; restore attributes on close. **Use own aria-live=polite, not role=status**, reserved as unique toast region by E2E. Empty result sets expanded=false without nonexistent descendant.
- Fixed body portal positioned below trigger-line cursor, above if more room; if neither fits, scroll list without covering current line. E2E330px-height caught initial overlap. No floating-ui direct dependency.
- Fetch lazily on first trigger; ordinary typing requests nothing (E2E). Refresh at most60s. Failure says `Couldn't load suggestions. You can still type the link out.`, preserves typing, retries after≥5s. Previously fetched catalog remains on refresh failure. governanceRequest rechecks access on403/404.

**Creating from unresolved,6.2**

- Writable-Hub-source requirement simplifies to **canWrite**, since ensureDefaultHubSource creates Notes when absent, including creation from source-managed documents.
- **Wikilinks only:** relative md paths need source location a new Hub document cannot occupy. titleForNewDocument removes extension and requires same self-resolution test; path targets such as a/b get no entry.
- Entries: reader real dashed link with unavailable explanation; inspector Create; graph canvas link with Click to create tooltip; graph list Create. Reader/inspector pass from; graph omits it since several origins may share target. Read-only users unchanged, tested.
- Invalid title (empty,>512,newline) is **ignored, never truncated**, because truncation breaks resolution. Validate from UUID then readable document in **this workspace** via query service, for Cancel only. javascript/external/other-workspace/missing inputs fallback to list, each tested. Creation still service-authorized.
- Seeded-title drafts use title in their key so generic draft cannot overwrite seeded title or vice versa.
- Expected existing E2E changes: two reading-links cases now have link role/Create it tooltip for writers; graph ghost gains link role/name `… (unresolved; opens the form to create it), …`.

**Not implemented:** same-title hint, heading/alias completion after #/|, embeds, Source-specific completion.

## 7. Slice A: organization and archive

### 7.1 New APIs

Reuse `workspaceHttp` and the existing `POST …/archive` convention, such as `/api/workspaces/:id/archive`.

| Route | Action |
| --- | --- |
| `POST /api/workspaces/:wid/folders` `{sourceId?, parentId, name}` | createFolder, default source via ensureDefaultHubSource |
| `PATCH /api/tree-nodes/:id` `{name}` or `{parentId, position}` | `renameFolder` or `moveTreeNode` / `reorderTreeNode` |
| `POST /api/documents/:id/archive` / `POST /api/documents/:id/restore` | Existing idempotent archiveDocument/restoreDocument |
| `POST /api/tree-nodes/:id/archive` / `POST /api/tree-nodes/:id/restore` | Folder archive/restore |
| `POST /api/workspaces/:wid/documents` adds `parentId?` | Create within folders, already service-supported |

**First task is error mapping.** toWorkspaceErrorResponse lacks TREE_NODE_NOT_FOUND/FOLDER_NOT_EMPTY/TREE_CYCLE/INVALID_PARENT/CROSS_SOURCE_MOVE/HUB_MANAGED_OPERATION_REQUIRED (zero occurrences), so exposing services would yield500 INTERNAL_ERROR. Map node missing to hidden404; remaining five to409, each unit-tested. Planned UI guidance in Chinese explains next action, e.g. move/archive folder contents first; implementation language decision below supersedes this.

### 7.2 Actions and availability

Add FolderTarget and document.move/archive/restore, folder.new-document/new-folder/rename/move/archive/restore, create.folder. Three axes:

1. canWrite and confirmed.
2. HUB_MANAGED; source-managed always read-only.
3. ACTIVE Source; archive ACTIVE target, restore ARCHIVED.

**Registry displays; services execute and recheck each API.** IDs grant nothing.

### 7.3 Interface

- Document menu adds Move/Archive, Restore in archived display. Folder row gets context/ellipsis menu for create document/folder, rename, move, archive/restore. Sidebar creation adds folder; palette targets open document Move/Archive.
- Move dialog shows ACTIVE same-Source folder tree and root, excluding self/descendants; append destination (§7.6).
- **Keyboard:** focused row Alt+↑/↓ calls reorderTreeNode, live announces position. Verify no conflict with C/E// /Enter/Esc/I or tree arrows in browsers.
- **Archive feedback:** `Archived “X”.` with Undo restore. Open document archive navigates source list. Since active-only resolution breaks inbound links, document archive toast with backlinks warns `N documents link here; those links will stop working.`, singular for1.
- Refresh after changes using shared-layout refresh-on-arrival timing.

### 7.4 Documentation correction

Design-language §18 claimed document archive never existed. Service existed; only web entry was absent. Correct that fact and record link consequences.

### 7.5 A-1 implementation, 2026-09-30

- **API:** optional folder source defaults Notes; explicit source must belong to URL workspace or404, even if caller writes both workspaces. Parent absent/null means root. Document archive returns backlinks count before archive, null if unreadable without affecting archive. Validate path UUID format first→400, avoiding DB500.
- **Read-only writers get404, not403**, preserving Phase1 WorkspaceAccessDeniedError contract. UI hides actions; direct calls retain existing semantics.
- **All organization copy in English**, decided09-30: menus/dialogs/buttons/toasts/hints/errors. Replaces planned Chinese feedback patterned after old composer notice. Typographic quotes distinguish titles containing straight quotes. Centralize organize-messages.ts plus two dialog hints; Undo label unchanged. Older composer/upload-encoding Chinese remains untouched.
- **Creation:** Notes row adds Create folder beside existing+ rather than changing+ into menu; preserve Create document/C. Registry create surface decides presence. Empty workspace has no sidebar, so palette creates folders before first document; retain original document-first entry model.
- **Folder menus attach only to heading**, not whole li containing descendants, avoiding bubbled child context menus. Ellipsis keyboard via Tab/focused Enter.
- Expand current document ancestors once/document, so new nested document is visible; later user collapse stays.
- Archiving open document navigates source list, which may redirect first document/empty. Toast survives those navigations; undo returns original document/position. refreshOnArrivalElsewhere handles unknown redirected destination.
- new?folder ignores malformed IDs; valid but unwritable/missing/archived/cross-source parent reaches creation service, yielding plain INVALID_PARENT explanation. Breadcrumb folder name is descriptive only.
- **Excluded:** Move/reorder/palette Move (A-2); sibling name uniqueness, absent from schema and allowing duplicate unlike filesystem.
- Rename folder Undo restores old name; create folder has none.

### 7.6 A-2 implementation, 2026-09-30

- **PATCH has three exclusive shapes:** name; parentId with optional position; position alone reorders current siblings. Null parent is root; missing key means unspecified, so test key presence. Name+position→400, no partial mutation. Omitted position uses APPEND_POSITION max-safe integer, clamped by existing placeNodeAtIndex; service unchanged.
- **Position indexes all siblings, including archives.** Visual index+1 is wrong with hidden nodes. reorderStep uses neighbor stored position to cross it regardless of hidden nodes. Depends on contiguous Hub sibling positions after create/move. Test real service with six documents, B/E hidden,60 random steps comparing visible order, not pure helper only.
- **Move changes no links/revision/index.** Hub has no sourcePath and wiki resolution uses title, not tree position; no archive-like backlink warning.
- Dialog native radio tree: root/ACTIVE folders, exclude self/descendants/archived ancestors via pure moveDestinations. Current disabled; Alt+↓ appends. Native arrows; explicit fieldset Enter submit for browser consistency. **No search**, deliberate.
- Labels Move document…/Move folder…, not generic Move to…, because registry labels must stand alone in palette and match verb+noun menus. Folder no palette. Archive already added A-1; A-2 adds Move only.
- Undo PATCHes original parent/position. Reorder has no toast Undo; reverse key is inverse and per-key toasts obscure tree.
- Reveal moved-into folder with kh:reveal-folder, same visibility principle as ancestor expansion.
- Alt+↑/↓ requires that row's registry Move: no read-only/source-managed/archived effects or preventDefault. Extra modifiers excluded. Filtered tree live announces Clear the filter to reorder. Boundary announces already first/last, no request.
- During request until replacement tree arrives, **retain last direction only**, compute next against new tree. Held key makes one round-trip per step, release stops; down then up reverses rather than dropping up. Give up after3s.
- Restore focus explicitly after move for browsers unlike Chromium; unit simulates lost focus. Announce `Moved “B” up. Position 1 of 3.` in remounted polite live region so identical messages repeat. **Not role=status**, unique toast region required by existing E2E.
- **No macOS/Windows physical verification** required by A2.4; unavailable environments. Linux Chromium passed. No apparent tree Option/Alt conflict is inference, not measurement.
- Exclude drag, dialog search, reorder Undo.

## 8. Slice B: recents and favorites

**2026-09-30 status:** B.0 complete (§8.1); server favorites implemented by [Personal workspace #86](2026-09-30-personal-workspace-design.md) using personal_items. Preserve original knowledge_document_favorites/api/favorites proposal as history, not a plan to implement.

- **Original schema, superseded:** migration013 favorites(user_id,document_id,created_at), compound PK, no workspace_id; derive/join scope and policy so lost access disappears. Actual013 is versioned/tombstoned personal_items for drafts/favorite:documentId.
- **Original API superseded:** actual `/api/workspaces/:id/personal` endpoint.
- **Migration implemented #86:** merge browser favorites once without overwriting remote deletions, favorite-sync.ts.
- **Recents remain local:** IDs/order in kh:document-shortcuts:workspace, at most8.

### 8.1 B.0 implementation, 2026-09-30

Two changes without migration:

1. **Blank palette lists recents first**, Recent heading, max8 excluding open document. Typing replaces with search; clearing restores. No recents leaves old palette unchanged.
2. **Sidebar favorites shows latest4 and Show all N.** Above4, existing ui/menu opens all favorites as real role=menuitem links with modifier new-tab. Primitive handles arrows/Esc/focus return. ≤4 shows no extra row.

**Two-version deviation:** plan said no4 cap. First showed all with max-h-72/18rem internal scrolling and claimed tree remained visible. Layout disproved:1280px width/>10 favorites tree starts366px down;720px viewport/604px sidebar leaves≈238px tree,600px leaves≈118px, plus nested wheel scrolling. Four+Show all fixes height independent of count (E2E<240px), no nested scroll; counted entry solves hidden starred documents.

**Costs:** fifth onward needs another click; menu has no star button, remove via first4/tree/document; no search.

**Not purely client as planned:** IDs/order stay local, but titles GET recent-documents?ids=a,b,c on each palette open. Stored titles become stale on rename or disclose archived/revoked content; fresh authorized lookup handles all three. One small request, at most8 IDs, no body.

Route follows ID-not-authority:

- Membership first through listSources, uniform hidden404; each getDocument rechecks. Missing/archive/malformed/revoked silently omitted, no existence disclosure.
- Only URL workspace's documents; derive actual scope, omit cross-workspace IDs.
- Only documentId/sourceId/current title/sourceName, no content/revision; private/no-store.
- Request order retained, no extra documents; client sorts local history. MAX_RECENT_DOCUMENTS8; parseDocumentIdList removes invalid UUIDs/duplicates.
- Network/5xx fallback no recents, no error, old palette.

**Recents-first changes default Enter** to the preceding document instead of first navigation action, useful for switching between two documents; empty-query Enter no longer navigates by default. No recents still selects navigation, pinned by E2E/registry tests. Reverting is moving recentRows after rows, without activeIndex change.

**Loading:** actions appear before usually tens-of-ms response, then recents insert above. listbox aria-busy=true from opening render, not after effect; reader/E2E wait for stability. If user selected an action during loading, preserve that row as it shifts, not numeric index. Untouched default becomes newest recent. Identify current document from URL documentIdInPath, not later page effect, so it never flashes in recents and shifts selection again.

**Excluded:** favorites unlimited storage but no sidebar sorting/grouping/search (newest first); palette shows recents, not favorites, available sidebar/Home.

## 9. Authorization and invariants

| Invariant | Enforcement |
| --- | --- |
| Derived scope | Proposed favorites omit workspace_id; tree uses existing Source paths |
| IDs do not authorize | Services recheck new APIs; from affects navigation only; registry hiding is not authority |
| Ownership controls writes | Organization/archive only HUB_MANAGED; source rows omit actions |
| Index derived, no access decision | link-targets only authorized same-workspace documents; suggestions are not proof |
| No workspace resolution on shares | Copy works without workspace data; no editor on share, unaffected by0/D |
| ACTIVE/ARCHIVED only | No hard deletion, archives reversible |
| Revision writers atomically update edges | No new writer here; slice0 ensures editor Markdown preserves edges |

## 10. Order and PR boundaries

| Order | PR | Content | Size* | Dependency |
| --- | --- | --- | --- | --- |
| 1 | 0 | Node, round trips, rendered E2E, read-only damage report | M | None |
| 2 | C | Highlight, syntax tokens, Copy | S | None |
| 3 | A-1 | Document/folder archive/restore, create/rename folder, nested creation | M | None |
| 4 | A-2 | Move dialog, keyboard order, palette | M | A-1 |
| 5 | D | Targets API, completion, unresolved creation | M |0 |
| 6 | B.0 | Palette recents, all-favorites entry, planned client-only/no migration | S | Independent, ship anywhere; B.1–B.4 deferred |

\* Estimates by changed files/new decisions: S one PR/no new decisions; M one PR/multiple interfaces/test layers; L multiple PRs. No time conversion without a project velocity baseline.

0 cannot wait. C is small with immediate daily value. A is largest gap, split for review. D depends on0 and benefits from post-A folder-aware creation planning.

## 11. Tests and verification

- **Rendered-mode required:** editor/composer/Markdown changes need E2E without showMarkdown; defect came from bypassing default path.
- **Extractor rules define editor:** shared fixture list prevents divergent requirements.
- Each slice includes pure/registry unit, API/service integration with source-managed/archived/read-only refusals, user E2E, tsc/eslint/build.
- Write `docs/superpowers/verification/2026-09-29-personal-daily-driver-verification.md` with measured values and honest failures/deviations.
- Measure link-targets2000/5000 documents response/payload and1MB/200-block highlight overhead.
  - **D measurements,09-30, same machine/process, no HTTP:**2000 p50=15.9ms,406KiB/gzip53KiB;5000 p50=42.5ms,1016KiB/gzip132KiB; client sorting5000 per key p50≤1.8ms. Within expectations; server fallback remains unimplemented. See verification.

## 12. Decisions and risks

**Decided 2026-09-29**

| # | Question | Decision | Plan effect |
| --- | --- | --- | --- |
| 1 | B in batch1 | **Defer**, B.0 recents/all-favorites only | B.1–B.4 migration/API/sync/rollout excluded |
| 2 | Repair damage | **Read-only report first, decide after counts** |0.10 report only, no repair/write code |
| 3 | Archive naming | **Archive** | Archive/Restore everywhere, no Delete |
| 4 | Drag organization | **Defer**, Move dialog/Alt arrows first | No drag A-2; assess usage later |
| 5 | Code languages | **Defaults common+dockerfile/groovy/protobuf** | Verify common in C.1, amend specification if mismatch |

**Decided 2026-09-30**

| # | Question | Decision | Plan effect |
| --- | --- | --- | --- |
| 6 | Open Team now | **Announce, defer**; disabled Team workspaces · Coming soon in switcher | KM_TEAM_WORKSPACES_ENABLED defaults false, exact true only. **Original decision affects switcher, not access**; direct links/APIs unchanged, see [operations](../../operations/team-workspaces-availability.md). Team organization/archive unchanged. Opening note records later server rollout that supersedes this. |

**Risks**

- Milkdown7.22 custom node/plugin API had been read, not implemented; first spike catches infeasibility early.
- Inline-html output is an assumption (§4.1); replace with custom handler if false, same scope.
- Other normalization (bullets/table spaces) accepted by#62 remains;0 guarantees link syntax only.
- Alt arrows need macOS/Windows browser measurement; change binding if needed without redesign.
- Archive breaks links by ACTIVE-only resolution, an intended consequence requiring notice (§7.3), not a defect.
