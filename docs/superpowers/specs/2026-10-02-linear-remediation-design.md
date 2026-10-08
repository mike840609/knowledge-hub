# Linear alignment remediation

The October 2 audit is the backlog; baseline is main `1cf8114`. The user authorized implementation in the recommended order. Preserve the incumbent typography, semantic light/dark palette, authorization, ownership, drafts, revisions, shortcuts, and knowledge model.

## Navigation and writing

Desktop retains separate navigation regions: the primary rail is 160px expanded or 48px collapsed, and the contextual explorer is independently 288px wide. The explorer starts at the top beneath the global header and keeps its full height when primary navigation collapses; ⌘\ retains its binding. The topbar retains the original brand/collapse region, separate workspace selector, then Search; the first two desktop regions align with the primary rail and explorer. *(Superseded by `2026-10-08-workspace-switcher-in-rail-design.md`: the switcher moved to the top of the rail and Search took the explorer-aligned slot.)* Reader and composer still reserve the same outline column. On narrow screens a single left Menu drawer contains primary navigation and the explorer. CSS hides the desktop explorer before hydration. One explorer instance portals between the desktop region and mobile drawer to preserve route contexts and avoid duplicate IDs/state.

Reader and composer use DocumentPane with the same reserved outline geometry. The composer's breadcrumb, Save/Cancel/Markdown actions and draft state remain visible inside its scroll container. The header wraps on small screens. Reader contextual Edit/Share/Details stay available in the topbar after its document header scrolls away. Source detail adopts PageHeader.

## Daily operations

Home prioritizes drafts, recent work and favorites. Organize and Export move to a More menu; export scope appears when that menu is open. Document rows reuse action-registry menus and accessible focus treatments, with compact metadata on phones. Empty draft/favorite descriptions do not dominate the first screen. Palette retains recent documents first, omits redundant current-section navigation for an empty query, and prefers document actions next. Sources adopts the shared arrow-key list navigation without replacing native links.

English is the existing interface language and is used for new operational copy and the affected mixed composer messages. Technical diagnostic codes and raw audit names move to details; the main text names the issue and next step. Unknown values have a readable fallback and retain their raw value for investigation.

## Scale and history

Home receives document summaries from an authorization-aware read service rather than a revision query per document. Import groups and diagnostics show bounded batches with explicit Show more controls. Version comparison presents changed lines and counts while retaining raw Markdown and restore-as-new-revision semantics. Static checks enforce non-arbitrary type/radius/rhythm values, with documented geometry exceptions; Tailwind itself permits arbitrary values.

## Verification and stopping boundary

Confirm long public share scrolling and title ownership; actual compiled controls and hint contrast in both themes; navigation, drawers and pane geometry at desktop/mobile; long-document Save, drafts and conflict paths; palette/row keyboard behavior; bounded import presentation; authorized summary reads and revision diff. Run existing checks relevant to affected code and add behavioral regressions where necessary. F13 is already implemented on main. F16 remains an optional comparison: the incumbent cool neutral palette is deliberately preserved unless a comparison shows a clear reading advantage; it is not a mandatory rebrand.
