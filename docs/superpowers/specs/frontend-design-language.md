# Knowledge Hub — Frontend Design Language

| Item | Value |
| --- | --- |
| Type | Living contract |
| Status | Current. Amended in place. |
| Supersedes | `docs/superpowers/specs/2026-09-13-phase-2.5-frontend-product-baseline-design.md` §25–30 |
| Token values | `tailwind.config.ts`, `src/app/globals.css` |

## 1. Status of this document

This document is **not dated**, and that is deliberate.

The rules below were first written as §25–30 of the Phase 2.5 design. Because
they lived inside a phase document, nothing consulted them once Phase 2.5
closed, and the implementation drifted from them twice: the shipped code
carried 12px overlay radii and a shadow on a textarea against §26's explicit
rules, and a later refactor drifted further before the divergence was caught.

A visual contract is not a phase decision. It applies to every phase that
renders a pixel, so it is kept here as a living document and edited in place.
There is no dated successor to look for.

The corresponding sections of the Phase 2.5 design are marked superseded and
point here. Everything else in that document stands.

**Token values are not repeated here.** They live in `tailwind.config.ts` and
`src/app/globals.css`. This document names the vocabulary and says when to
reach for each token; a second copy of the numbers would be a second source of
truth, which is the failure this document exists to prevent.

## 1a. Reference values and their provenance

Where this contract states a number rather than a principle, the number comes
from measuring the reference product rather than from taste.

The values were read from the public CSS served by `linear.app` on
2026-09-20 — `layout.B05Dfi6O.css` for the token ladders, and the `Button`,
`CommandMenu`, `Select`, `Tooltip` and `KBD` stylesheets for how they are
applied:

```text
radius ladder   4 / 6 / 8 / 12 / 16 / 24 / 32, plus circle and rounded
control radius  6 (Select)        tooltip 8       command palette 12
button heights  24 / 32 / 40 / 44
type sizes      10 / 12 / 13 / 14 / 15 / 17 / 20 / 24
tracking        10px -.015em, 12px 0, 13px -.01em, 14px -.013em,
                15px -.011em, 17px 0
```

**The limit of this evidence:** that is the marketing site, which shares the
design system with the product but is not the product. It is far better than
recollection and worse than the app itself. Treat these as the best available
reading, not as gospel, and prefer a fresh measurement to an argument.

Where this product has no counterpart at a measured size, the value is
interpolated between the two nearest rungs and marked as such in
`tailwind.config.ts`. Nothing is invented.

## 2. Principles

The product adopts a Linear/GitHub-inspired workbench. The intent is not
visual imitation. The principles are:

- compact
- high information density
- low decoration
- clear hierarchy
- fast scanning
- action-oriented interaction
- restrained color
- consistent panels and separators

## 3. Enforcement

The `fontSize`, `borderRadius`, `boxShadow`, `transitionDuration`,
`transitionTimingFunction`, `padding`, `margin`, `gap` and `space` scales in
`tailwind.config.ts` are **replaced**, not extended.

Tailwind therefore emits no class for a value the system does not name.
`text-[13px]`, `rounded-xl`, `shadow-sm` and `p-7` produce no CSS. `borderRadius`
carries no `DEFAULT` key, so a bare `rounded` does not compile either.

This is what makes the rest of this document binding rather than advisory. A
contributor cannot introduce an off-scale value without noticing, and a
reviewer does not have to catch it by eye.

Adding a token is a change to this contract. Make it here and in the config
together, and say what job the new token does that no existing one covers.

## 4. Token vocabulary

| Scale | Tokens | Job |
| --- | --- | --- |
| Type (UI) | `micro`, `caption`, `body-sm`, `body`, `title`, `heading` | `body` is the ~14px default the UI spends most of its time in |
| Type (document) | `reading`, `display` | rendered Markdown only; a longer measure wants a larger size and looser leading |
| Radius | `sm`, `md`, `lg`, `xl` | see §5 |
| Elevation | `popover`, `modal` | floating surfaces only |
| Border | `border`, `border-strong` | see §6 |
| Container | `page`, `wide`, `reading`, `panel` | see §7; the `maxWidth` scale is replaced, so `max-w-4xl` does not compile |
| Spacing rhythm | `0`, `px`, `0.5`–`6` every half step, `auto` (margin), `16` (padding) | paddings, margins and gaps; `16` is `StatusMessage` only, see §7 |
| Control height | `sm`, `md`, `lg` (24 / 32 / 40) | see §15; buttons and fields read the same ladder |
| Motion | two durations, one easing curve | see §9 |

## 5. Radius

Four rungs, taken from the reference ladder (see §1a):

- `sm` 4px — inline chrome: `kbd`, inline code, badges. These sit inside a
  text line and take the control radius badly.
- `md` 6px — controls, rows, panels, sections. The default.
- `lg` 8px — menus, dropdowns, popovers, tooltips.
- `xl` 12px — modals, dialogs, the command palette.

`lg` or `xl` appearing on a panel is a bug, and so is a modal at `lg`. The
rule is checkable by grep, which is the point of stating it by surface rather
than by feel.

Large SaaS-style rounding — uniformly heavy radii on ordinary cards and panels
— is avoided. That is a rule about panels, not an argument against tiering:
the reference tiers its own radii, and one small radius shared by a 32px
button and a 640px command palette reads as undersized on the latter.

### Superseding the original §26

Phase 2.5 §26 specified two tiers, `4px default / 6px interactive, floating
surfaces`. The reference's own ladder has seven rungs and puts tooltips at 8
and the command palette at 12, so the two-tier rule does not describe the
language this product follows. It is superseded.

An earlier revision of this contract used a third tier at 10px. That value is
not on the ladder at all — it was chosen by feel, which is exactly the failure
this document exists to prevent.

## 6. Elevation and borders

Normal application surfaces do not use shadows. Both elevation tokens are
reserved for floating surfaces.

Subtle 1px neutral borders are the main structural device. Prefer a
border, separator, panel boundary or selected background over a floating
card.

There are two border tokens, and picking the wrong one is a defect in both
directions:

- `border` — **structure**: dividers, panel edges, separators, table and code
  block boundaries. Decorative. It must stay below the hover fill in
  lightness; a static line that out-shines an interactive state inverts the
  hierarchy and reads as too bright. This happened once in dark: the divider
  sat at L\* 18.4 against a hover fill at L\* 15.2.
- `border-strong` — **control boundaries**: any control whose border is the
  only thing separating it from its background. That is every form field
  (`Input`, `Select`, `Textarea`) and the `secondary` button, all of which
  fill with `bg`, the canvas colour. WCAG 1.4.11 requires 3:1 for non-text
  boundaries that identify a component, and a decorative divider cannot meet
  that and stay decorative. Read it as a rule about the job, not as a list of
  components: the hand-rolled `<select>` elements scattered through settings
  and imports all carried `border` and all failed the rule, precisely because
  they were not on the list.

A scrollbar is a control too: its thumb takes `border-strong` over a
transparent track, at the platform's `thin` width. The default 15px gutter was
the widest thing in the chrome.

`border-strong` is validated against **every** surface it can sit on, not just
the canvas — `subtle` and `sunken` are the tight cases and a value chosen
against the canvas alone will fail them.

Cards are intentionally rare. Prefer:

```text
Row
Panel
Section
Separator
```

## 7. Surfaces

Four steps of one cool neutral hue, each with a single job:

```text
bg          canvas — document and page content
bg-raised   chrome on the canvas — topbar, inspector panel
bg-sunken   navigation rails — primary nav, knowledge sidebar
bg-subtle   inset fills — code blocks, table headers, kbd
```

A document is content, so it sits on `bg` like every other page. The
document pane had been painted `bg-raised` whole, header and body alike,
which put documents on a lighter surface than every other page in dark
(#191a1e against #131417) and left the share page with a raised band over a
canvas body. Neither was a choice anyone recorded.

Names say what a surface is, not where it was first used. The previous names
(`reading-bg`, `bg-nav`, `bg-sidebar`) are why a warm grey and three cool ones
ended up adjacent without anyone noticing.

### Three page containers, named by job

```text
kh-page            56rem  the standard page — lists, forms, detail views
kh-page-wide       64rem  a page whose content is a table
kh-reading-column  860px  prose measure — the document, its editor, and
                          every message state
```

They are classes rather than remembered widths, and the `maxWidth` scale is
replaced like the others, so `max-w-4xl` compiles to nothing and a sixth width
cannot appear quietly. `panel` (36rem) is the one non-page width the scale
keeps, for a form panel sitting inside a page. Arbitrary values still work,
because a truncation width on a label is not a container.

Five widths were in use for what was mostly the same page: `2xl`, `3xl`,
`4xl`, `5xl` and the reading column. Only three of those distinctions were
real. Most of what the odd widths were doing was holding a message — a
not-found heading with no explanation, an empty state — and those do not need
a width of their own: they use `StatusMessage`, which sits in the reading
column. Nine such blocks were spelled out inline, eight of them a bare `<h1>`.

A page's header is one line, `location › title`, with actions at the right
(`PageHeader`). The title is body-size and medium weight: the page is named
where it sits, the way the document header names a document, rather than
announced above it. A form page may add one line saying what it does; a list
page does not restate its own name.

Page padding is `py-6`. `py-8` appeared on four sources pages for no reason
anyone recorded. The `py-16` of a centred message state belongs to
`StatusMessage`, not to the pages that show one.

### Divergence: this ramp is tinted, the reference's is not

Measured, the reference's light surfaces are achromatic — `#f8f8f8`, `#f4f4f4`,
`#f0f0f0`, chroma 0 — and its dark surfaces are close to it. Its accent carries
all of the colour. This ramp is cool-tinted instead, chroma 2 to 8.

That is a deliberate choice and not a reading of the reference. It is recorded
here because the earlier wording, "four steps of one cool neutral hue", read as
though the tint were the rule being followed rather than a departure from it.
Either is defensible; claiming the wrong provenance is not.

Its dark ramp also sits lower: canvas at L\* 2.4 against this one's 6.3, with
tighter steps. A near-black canvas and a soft dark one are a matter of taste,
not correctness.

## 8. Colour

One restrained accent, used for selected state, focus, primary action and
active navigation. Hierarchy relies on weight, size, spacing and foreground
level rather than decorative colour.

### Foreground levels

Four, matching the depth the reference carries:

```text
text            primary   — titles, body, anything being read
text-secondary  content one step down — snippets, supporting prose
text-muted      metadata and chrome — timestamps, counts, breadcrumbs
text-faint      hints that are not content — kbd, separators, disabled
```

`text`, `text-secondary` and `text-muted` all meet 4.5:1 against every surface
they can sit on and may carry body text. **`text-faint` meets 3:1 and may
not** — it is for marks a reader can ignore without losing meaning.

A group label in a navigation rail (Documents, Favorites, Recent) is
`caption`, medium, `text-muted`: one style, so a label never reads as another
row. Collections and rows below it keep `body`.

Two levels were not enough, and the symptom was concrete: a search result's
snippet and the metadata beneath it rendered in the same colour, so content
and chrome read as one undifferentiated block.

Semantic colours carry meaning only. Each of success, warning and danger has a
text colour, a tinted background and a border, so status is scannable at a
glance rather than distinguishable only by reading.

`--kh-danger` is split into a text colour and a solid surface. A filled
destructive button needs a mid red that holds white text; danger text on a
dark background needs a light red. One token cannot serve both once a dark
theme exists.

No component declares a colour outside the token layer.

### On ladder depth

The reference carries more rungs than this contract does — three border levels
plus a translucent one, four line levels plus a tint. This product has two
(`border`, `border-strong`) because it has two jobs to express: a decorative
divider and a control boundary. Depth is added when a surface needs a
distinction that cannot be made with what exists, not to match a count.

## 9. Typography and motion

UI text is approximately 14px; document body 15–16px.

**Every size carries its own tracking.** The reference pairs each step with a
negative letter-spacing tuned per size rather than derived from a formula —
12px sits at 0, 13px at -.01em, 14px at -.013em, 15px at -.011em — and that
tuning is a large part of why a dense UI stays comfortable to read. A size
token without letter-spacing is incomplete; this contract shipped that way
once.

Line heights are this product's own. The reference sets 15px at 1.6 for
marketing prose; the document scale here is looser because it serves a longer
measure.

The typeface is loaded, not inherited from the platform — the default sans
varies most at the 11–14px sizes this UI lives in. Timestamps and figures that
re-render in place or stack into columns use tabular numerals.

Motion is two durations and one ease-out curve. Overlays enter and leave;
nothing appears instantly. `prefers-reduced-motion` is honoured by one global
rule, so no component has to remember it.

## 10. Focus and keyboard

One focus idiom: the ring, composed from `.kh-focus-ring`. Every interactive
surface uses it. There is no second spelling, and `no-restricted-syntax` in
`eslint.config.mjs` now says so in a form the build can check.

It needed that. This was the only rule in §3–§11 with nothing enforcing it —
the type, radius, elevation and container scales are replaced in
`tailwind.config.ts`, so an off-scale value does not compile — and it was the
only one the codebase broke, in 29 places across 17 files. Ten of those copies
left out `outline-none`, so the browser drew its own black outline on top of
the themed ring; that one is a visible defect in both themes and neither
review nor the type checker had any way to see it.

A rule stated absolutely and enforced by nothing is a rule that decays at the
rate people forget it.

**Every list of rows is navigable by arrow key**, with the same idiom: the
container owns a `keydown` handler, Up/Down move focus between rows, Home/End
jump to the ends, and Enter is left to the row's own element so `⌘`-click and
middle-click keep working. Where a list has a query field above it, ArrowDown
from the field enters the list and ArrowUp off the first row returns to it, so
the two read as one control.

Rows keep their natural tab stop rather than taking a roving tabindex, unless
the list is long enough that tabbing through it is the greater harm — the tree
is the exception. A roving tabindex leaves every row unreachable if its script
does not run.

This applies to the knowledge tree, the `⌘K` palette, the search results page
and **menus** alike. A list that is reachable by mouse and not by keyboard is a
defect, and both the search results page and every menu shipped that way once.

### Shortcuts

`Action.shortcut` in the registry is the one place a shortcut is defined. The
same value binds the key, is the `aria-keyshortcuts` on the button that does
the same thing, and is the hint shown beside the action in the palette
(`shortcutLabel`), so the three cannot disagree. Adding a shortcut is filling
that field.

A single key (`C`, `E`, `/`) is also a character, so it acts only when
`isSingleKeyShortcut` in `lib/shortcut-keys.ts` says so: no `⌘`, `Ctrl` or
`Alt`; not mid-composition in an input method (a letter typed while composing
Chinese is text, not a command); not inside a field, a dialog, a menu or a
listbox; not a key repeat; and no Shift, except for `/`, which some layouts
only type with it. Keys are compared by `event.key`, what the reader sees on
the keycap, not by position.

Single keys are bound in the palette (`quick-search.tsx`), from the same
actions it lists, so `E` exists exactly when "Edit document" is offered there:
on the document being read, when the registry's three availability axes allow
it. The row menu shows no hints. It acts on the row it was opened from, and a
row's "Edit document" beside an `E` that edits a different document would be
a lie on every row but one.

In the document forms, ⌘Enter saves through the form's own submit button, and
only when that button is enabled. `Esc` leaves only a form nothing has been
typed into; with changes it does nothing. No key discards a draft; Cancel is
the one way to.

"Edit document" enters the editor by a full page load (`effect.kind ===
"load"`) from every surface, as the header's Edit link always has. A client
navigation there left the document page in the router cache, and the push
back after a save then showed the old revision until a reload. The palette and
row menu had that bug from the day they offered Edit; no test saw it, because
every test entered the editor through the header's plain link.

### Menus

Menus are lists of rows, so the rule above governs them, and a `<details>`
element cannot satisfy it. `src/components/ui/menu.tsx` wraps Base UI's `Menu`
— the same library that already owns Dialog, Tabs and Button — and is the only
way a menu is built here. Dismissal, outside clicks, focus return and
arrow-key movement come from it rather than from a hand-written `keydown`
handler per menu.

Rows sit on the control height so a menu reads as part of the same system, at
the `lg` radius and `popover` elevation that §5 and §6 give floating surfaces.
A section long enough that it should not sit open becomes a submenu rather
than a nested disclosure.

Choosing an option closes the menu. The exception is a choice whose effect is
visible in the menu itself — picking a theme is the one case — where staying
open lets the reader see what they did.

A row's menu may also open on right-click and long-press, through Base UI's
`ContextMenu` rather than a `contextmenu` listener of our own, which is what
gives the long-press. **Right-click is never the only opening.** A row that
carries one also carries a visible trigger showing the same items, because a
pointer gesture no keyboard or touch user can perform would put those actions
out of reach — the same rule that makes arrow-key movement mandatory two
paragraphs above. Both openings render the same component for the same action,
so they cannot drift apart.

**A replacement menu may not be poorer than the one it replaced.** Taking
over right-click on a row that is a link takes the browser's own menu away, and
that menu offered *Open in new tab* and *Copy link address*. Both are in the
registry, on every document row, whatever the reader may otherwise do there —
they are reading, not writing. Copy link also appears in the palette, where it
copies the page being read, and it reports through the toast because the menu
it is chosen from has already closed; the clipboard can refuse, and says so.
This was missed on the first pass and found by reading the product rather than
the diff: middle-click still worked, so nothing looked broken.

That trigger is floated over the row's own background rather than given a
column of its own. A second reserved control slot re-truncates every label in
the tree to buy a button that is invisible most of the time; a float costs
nothing when hidden. It follows that a row holding a floated control must have
a background whenever that control is showing, which is why
`.kh-interactive-row` tints on `focus-within` as well as on hover.

## 11. Navigation state

A view returns to where it was left, not to the top. Scroll position is
remembered per view and restored on return; going somewhere new still starts
at the top, and a hash target is left alone so in-page anchors keep working.

What the user has arranged is theirs to keep. Filters, expansion and
collapsed sections belong in the URL when they should be shareable, and in
storage when they are a personal preference — not in component state that a
refresh discards.

Which storage is part of the decision. A choice keeps (`localStorage`): which
sources are expanded, which folders are collapsed, which sections are open,
whether the nav rail is collapsed. Work in progress lasts the session
(`sessionStorage`): a find-as-you-type filter is worth keeping across a
refresh and not worth greeting someone with a week later, when a stale needle
would make the tree look empty for no reason.

`usePersistedJson` in `components/shell/use-persisted-state.ts` is how, and
it exists because the hand-written version gets two things wrong. It must
read in an effect, not during render, or the server and the first client
render disagree; and it must not write before it has read, or the first
render overwrites what was stored with the fallback. Storage access is also
wrapped, because reading `window.localStorage` **throws** rather than
returning null where a browser blocks it — unguarded, that took down the
whole shell rather than losing a preference.

## 12. Theme contract

Light and dark must both resolve every token.

**The theme is the reader's explicit choice and nothing else.** Dark is served
by one selector, `:root[data-theme="dark"]`. The system's
`prefers-color-scheme` is deliberately not consulted, so the control reflects
what was last picked rather than changing underfoot when the OS switches.
Light is the starting point until someone picks otherwise.

The choice persists to `localStorage` under `kh:theme`. A pre-paint script in
the document head applies it before the first frame, so a reader who picked
dark never sees a light one. It stamps `data-theme` unconditionally, defaulting
to light, so the DOM states which theme is in force from the first byte rather
than only after hydration.

Because the script writes to `<html>` before React hydrates, the server HTML
and the DOM React finds disagree on that one attribute by design. The root
layout marks `<html>` `suppressHydrationWarning`; React applies it to that
element's own attributes only, so a real mismatch anywhere below still reports.

### What this costs

A visitor whose OS is set to dark gets light until they pick, and with
JavaScript disabled the theme cannot change at all. An earlier revision served
both, with a media query alongside the attribute; that meant two blocks of
identical values that had to be edited together, and a toggle that could not
return to following the system once touched. Trading those away for one
source of truth and a control that always tells the truth about its own state
is the deliberate call recorded here.

Should following the system be wanted again, it returns as a third state on
the control — `light` / `dark` / `system` — not as a second CSS block. The
attribute stays the only thing the stylesheet reads.

## 13. Icons

A consistent outline icon language (Lucide). In primary navigation, icons
support labels rather than replace them.

One stroke weight, 1.5, set once in `globals.css` for every `svg.lucide`.
Lucide's default of 2 at the 14–16px these icons render drew heavier than the
text beside them, and call sites had drifted to three weights (2, 1.8 and the
default). No call site passes `strokeWidth`; the rule overrides it anyway.

The one native control with a platform glyph, `<select>`, gets a chevron in
the same weight (`.kh-select`), drawn as two gradient strokes in
`text-muted`. It keeps native behaviour and needs no wrapper element. It is
not an SVG: `img-src 'self'` refuses `data:` images, which is the Markdown
image policy doing its job, not something to loosen for a glyph.

## 14. Frontend technology

```text
Base UI
+ Tailwind CSS
+ Knowledge Hub semantic components/tokens
```

> Base UI owns interaction behavior. Tailwind and Knowledge Hub tokens own
> appearance.

Do not introduce HeroUI or another opinionated full visual framework.
Shadcn-style component architecture and accessibility patterns may be used as
implementation references.

## 15. Component architecture

Low-level reusable primitives belong under `components/ui`. Product and domain
components stay separated by responsibility:

```text
components/
├─ ui/
├─ shell/
├─ knowledge/
├─ search/
├─ sources/
├─ imports/
├─ workspaces/
└─ errors/
```

Product behavior must not leak into generic UI primitives.

A primitive owns its own shape. When a link or anchor needs a control's
appearance, it takes the shape from the primitive — `buttonClasses()` — rather
than restating it. Twenty-one hand-rolled copies of the button class string
were how the button system drifted the first time.

**An override is drift too.** Reshaping a primitive through `className` — a
height, a padding, a radius — defeats the thing the primitive exists for, and
it is harder to catch than a hand-rolled copy because the import looks right.
`search-form` passed `className="m-1 min-h-9 px-4 py-1.5"` to a `<Button>` and
escaped the sweep that found the other twenty-one. If a call site needs a
shape the primitive does not offer, the primitive gains a prop.

### Controls sit on one height ladder

24 / 32 / 40, named `sm` / `md` / `lg`, defined once in
`components/ui/control.ts` and read by buttons and fields alike. Spelling a
height per component is how `Input` arrived at `min-h-10` while `Button` said
`h-10` and the search field said neither — three values for one rung, and a
form row that did not line up.

**Fields and buttons share a default rung**, `md`. They did not before — every
form in the app paired a default `<Button>` at 32px with a default `<Input>`
at 40px — and a default that has to be opted out of to line up is not a
default. A form that wants more presence opts the whole row up together; the
search page is the only one that does.

This was reverted once and then restored, so the alternative is recorded
rather than left to be proposed again: 40px fields with a 36px button inset
into a 44px search box, and a `ring-offset-2` on fields alone. It is a
defensible look and it costs three standing departures from this section —
two heights that are not rungs, a default that does not line up, and the only
offset focus ring in the system. Reopening it means accepting those three,
not just the appearance.

**Rows sit on the ladder too.** A navigation or tree row is `md` (32px) and
the control floated inside it is `sm` (24px). Rows were 36px with a 28px
floated button, neither on the ladder, so a sidebar row, the menu row that
opens from it and the button beside it were three unrelated heights. The
reference's sidebar is denser still, at roughly 28px; `md` is the nearest rung,
and a rung is not added for one surface.

Every form field is `Input`, `Select` or `Textarea`, which share their shape
through `fieldClasses()` in `components/ui/field.ts`. `Select` is a native
`<select>`: the search page is a plain GET form that works without JavaScript,
and every hand-rolled copy it replaces was native already. With JavaScript,
that form searches as the reader types and its submit button goes
(`LiveSearchSubmit`); the URL is still the state, so a search stays
shareable, and without JavaScript the button and the GET remain. A multi-line field
takes its height from `rows` rather than the ladder; only its padding scales.

### Tabs come in two kinds and share only their look

Base UI's tabs swap panels inside one page and mark the current tab with an
attribute. Sibling routes cannot use them: each tab is a link to its own URL
and the current one is decided by the pathname. They are different mechanisms
and must not be forced into one component.

They do share the look, which lives in `components/ui/tab.ts` so that changing
a tab changes both. A route tab bar is `NavTabs`: links carrying
`aria-current="page"`, not `role="tab"` — claiming the tab role would promise
arrow-key movement between panels that a set of links does not have.

The current route is matched exactly, not by prefix. A section's index tab
lives at the section root, so a prefix match leaves it lit on every page in
the section.

### One loading idiom, one message shape

A region that is loading shows a skeleton shaped like what is being fetched,
paired with a screen-reader-only `role="status"` line, because a skeleton is
`aria-hidden` and on its own announces nothing. Prose such as
`Loading documents…` is not a second option. The skeletons live in one module
per area rather than beside a caller: the document skeleton had two callers,
was copied into both, and the two drifted to different paddings, so the page
shifted as the route boundary handed over to the `Suspense` fallback.

**The document skeleton is kept knowing what it costs.** Measured, opening a
document takes 383ms at p50, of which about 250ms is the skeleton rather than
the work: the data is there at ~130ms, the main thread records no long tasks
in the remainder, and React throttles a Suspense fallback once shown so that
it cannot flash. Removing the boundary measures 141ms, and the previous
document stays on screen instead of a skeleton appearing. The full record is
`docs/superpowers/verification/2026-09-21-navigation-latency-measurement.md`.

Keeping it is a deliberate choice, not an unexamined one, and there is no
middle setting: an invisible or delayed fallback still commits, which unmounts
the previous document and leaves the region blank rather than stale. The one
lever that would keep the skeleton and drop its cost is prefetching the
document data rather than only the loading boundary, so that a navigation
finds the data already in the router cache and never reaches the fallback.
That is unmeasured; it would trade N prefetch requests per visible tree row
for it.

### One registry decides what can be done

`components/actions/action-registry.ts` holds the list of actions — who, in
what situation, may do what to what — and the palette, the row menu and the
empty state read it. No surface keeps its own list. Before it, every action
was welded to whichever screen happened to show it (Edit to the document
header, Import to the empty state, Archive to the settings panel) and nothing
could enumerate them, so each new surface designed the same list again and
agreed with the others by luck.

It returns data: no React, no routing, no icons. That is what makes the
availability rules testable without a DOM, and they are the part that is easy
to get quietly wrong. Icons are named and resolved at the surface.

**Availability has three axes, and conflating them is a defect, not a style
choice** (§17 and `CLAUDE.md` both say so):

1. workspace capability — `canWrite`, `canImport`, `canOpenSettings`, …
2. source ownership — `SOURCE_MANAGED` content is read-only in the Hub however
   capable the caller is
3. target state — an archived document, or a historical revision, offers
   reading, not editing

The document page had all three spelled out inline at one call site, which is
how the registry knows they are the right three.

**The registry is not authorization.** It decides what is *shown*. The
application service decides what *happens*, and must refuse an action that was
never offered, because knowing an ID grants nothing. Tests assert both halves
separately.

### A control that cannot do its job yet is disabled

A server-rendered `<form onSubmit>` with a `type="submit"` button and no
`action` is submittable before React attaches `preventDefault`. The browser
then performs a **native** submit — a GET to the same URL — the server
re-renders from stored state, and everything the reader typed is gone without
a word. Measured on the document editor: a draft in the textarea is replaced by
the saved content and the URL gains a bare `?`.

So a submit button is disabled until its form has mounted (`useHydrated`). The
brief disabled state is the truth, not a cosmetic cost: the form genuinely
cannot accept a save yet. It is also what makes the behaviour testable, because
a test clicking the button waits for it rather than racing it — CI caught this
as an intermittent failure where a second page loading in the same browser
delayed hydration past a save.

**`javaScriptEnabled: false` does not model this state.** These routes stream,
so their content arrives in a hidden `<div>` at the end of the body and an
*inline* script moves it into place; turning JavaScript off stops that too and
the form never reaches the page. Blocking the framework chunks is the faithful
version — inline scripts still run, React never hydrates.

### A timestamp is rendered in the reader's zone, which means twice

`components/ui/timestamp.tsx` is the only thing that renders a moment in time.
`formatDateTime` and `formatDate` take the zone as a **required** argument,
because leaving it to the runtime is precisely the defect: three of the six
render sites were server components, so the server's zone was what reached the
page and stayed there — a reader in Asia/Taipei was shown UTC on the Sources
list, in search results and in the audit log, permanently, not as a flicker.
A required parameter means a new call site cannot inherit that by omission.

Nothing in a request carries the browser's zone, so `Timestamp` renders twice
on purpose. The first pass — on the server, and again as the first client
render — formats in `SSR_TIME_ZONE` (UTC), so the two agree byte for byte and
React has nothing to reconcile. An effect then swaps in
`Intl.DateTimeFormat().resolvedOptions().timeZone`. **An explicit agreed zone
is the point**; formatting the first pass in the runtime's own zone is what
tore the markup before.

The cost is worth stating rather than hiding: for the moment before hydration,
and for a reader with JavaScript off, the visible zone is UTC. The `dateTime`
attribute always carries the exact instant, so nothing machine-readable is
ambiguous, and the e2e tests compare the rendered text against that attribute
re-formatted in the browser's zone rather than against a fixture string.

The locale is still one constant (§15, one module) rather than the reader's,
because honouring that one needs a server-side resolution — a header or a
stored preference — which is a product decision. The zone did not need one:
"the reader's browser" is answerable in the browser.

### Feedback has one place, and undo is a promise

`components/ui/toast.tsx` is the one region: fixed in a corner, mounted by the
app shell, `role="status"` with `aria-live="polite"`. It holds one message at a
time and clears on navigation, because a toast describes what just happened
*here*.

The region is rendered whether or not it holds anything. A live region
inserted at the same moment as its content is not reliably announced, and the
older pattern — a `<p role="status">` appearing inside the panel that
performed the mutation — also pushed the rest of that panel down as it
arrived.

**Messages split by whether the reader must act on them.** A failure stays
where the control is, next to the field or the button that produced it, and
can mark that field invalid; that is what `GovernanceError` is for. A
confirmation reports and gets out of the way, so it goes to the toast. A
mutation that *navigates* to its own result gets neither — saving a document
lands on the saved document, and a toast on top of that is noise.

**Undo is offered only where a reverse operation already exists.** An "Undo"
that cannot restore the previous state is a lie, and this codebase has no
soft-delete to lean on. Archiving a workspace, renaming it, granting access,
changing a role and revoking a grant all qualify. Editing a document does not:
its reverse would be a *new* revision, which is a feature and not an undo.
Applying an import does not: the import spec forbids both force-apply and
rollback.

The reverse call is not always the mirror of the forward one. Restoring a
revoked grant goes through the add endpoint, because changing the role of a
membership that no longer exists is refused — and it is a new grant, which the
audit trail records as such. The tests assert the state after the undo rather
than the toast, which is the only way that distinction shows up.

**A two-step confirmation is kept only where undo is impossible and the
consequence is real.** Asking twice before something reversible buys nothing
and teaches the reader to click through the prompts that matter.

Error and not-found states take their shape from `StatusMessage` — heading,
one line, optional action — so that a new boundary cannot invent a fourth
spelling. Boundaries are placed where the shell survives them: the workspace
boundary keeps the topbar and sidebar mounted so the reader can navigate away
instead of reloading. `global-error` replaces the root layout, so it restates
the stylesheet, the typeface and the theme stamp; without the last of those a
dark-mode reader is handed a white page at the worst possible moment.

## 16. State strategy

No Redux, Zustand or other application-wide state framework.

```text
URL              → Workspace / Source / Document, and anything shareable
Server data      → Workspace / Source / Tree / Document / Revision / Import state
Persisted local  → Scroll position, nav collapse, theme, favourites, and the
                   view arrangement the user set (see §11)
Local component  → Genuinely ephemeral chrome: inspector open, drawer open
```

Local component state is for what should not outlive the interaction. Tree
expansion and the tree filter are still held there and should not be; §11
covers why, and it is now done: `usePersistedJson` holds it.

A global state library is added only if a concrete requirement proves local
ownership insufficient.

## 17. Domain contract boundary

The frontend does not redesign or bypass the application/domain contracts:
workspace identity and access resolution, KnowledgeSource semantics, source
ownership, stable document identity, immutable revisions, archive lifecycle,
tree behavior, folder ingestion, the SourceEntry/provenance model,
Preview → Confirm → Apply, sync-version conflict handling, authorization
rules.

**Frontend work must not weaken server-side authorization. URL parameters are
navigation inputs, never authorization proof.**

A narrow read-only projection may be added where the UI needs information the
domain model already stores. Such a projection must not alter lifecycle
semantics.

## 18. Open items

Known gaps against the principles in §2. This list is canonical; the audit
that found them is recorded at
`docs/superpowers/verification/2026-09-20-linear-design-alignment-audit.md`,
which also covers what was addressed at the time and is a point-in-time
record rather than a tracker.

Each of these changes behaviour rather than appearance.

A fifth is closed on its own terms: timestamps now follow the reader's
browser (§15). It was the only item on this list that was a defect rather than
a gap — three of the six render sites were server components, so a reader
outside the server's zone was shown the wrong time and kept it.

Four items that used to head this list — `⌘K` searched only, no row carried a
context menu, empty states offered no guidance, and there was no toast or undo
layer — were four exits from one missing thing, a list of what can be done, by
whom, to what. That list now exists (§15) and all four read it, so they are
closed. The record of what was decided, and of two claims in the old wording
that turned out to be false, is
`docs/superpowers/specs/2026-09-21-action-model-spec.md`.

The toast item is worth one correction of its own: the announcement was never
broken. `role="status"` carries an implicit `aria-live="polite"`, and an
earlier wording here counted literal `aria-live` attributes and read as though
nothing were announced at all. What was missing was a place for feedback to
live that was not inside the panel that produced it, and an undo offered only
where it could be kept.

One of those claims is worth repeating here, because the old item is the kind
of thing a reader trusts: **archiving a document and copying a link do not
exist in this product**, and never did. The item said a context menu was
missing for three actions when two of the three had never been built. A
document archive would be a domain change, not a UI one; the decision on
record is to leave the lifecycle as it is, so the registry gains an entry if
that ever changes rather than being redesigned.


1. The palette is mostly navigation, and that is a product gap rather than a
   UI one. Counted against the code it can offer about fourteen entries, of
   which the majority are ways to get somewhere; a command palette does not
   create commands. Worth revisiting when this product has more a reader can
   do, not by adding entries that do nothing.
 2. `spacing` was the one scale still left at Tailwind's default rather than
    replaced, so paddings, margins and gaps were unenforced. Closed: `padding`,
    `margin`, `gap` and `space` are now replaced with the 2px-base ladder the
    codebase actually uses (`0`, `px`, `0.5`–`6`, `auto` on margin,
    `16` on padding for `StatusMessage`), and the three off-rhythm sites are
    migrated — document content padding unified at `py-6`, tree empty-state
    indent at the nearest rung, search-field icon clearance as a documented
    arbitrary one-off (icon geometry, not rhythm). Replacing `spacing`
    wholesale stays the wrong fix: Tailwind feeds it to `width` and `height`
    too, and a 288px sidebar is not a decision about rhythm. (Page container
    widths were the other half of this item and are now §7.)

## 19. Completion criteria

- Off-scale type, radius, elevation, motion and spacing-rhythm values do not compile.
- The `lg` radius and both elevation tokens appear only on floating surfaces.
- No component declares a colour outside the token layer.

### On ladder depth

The reference carries more rungs than this contract does — three border levels
plus a translucent one, four line levels plus a tint. This product has two
(`border`, `border-strong`) because it has two jobs to express: a decorative
divider and a control boundary. Depth is added when a surface needs a
distinction that cannot be made with what exists, not to match a count.
- One focus idiom across the codebase.
- Light and dark themes resolve every token.
