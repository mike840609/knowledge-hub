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

The `fontSize`, `borderRadius`, `boxShadow`, `transitionDuration` and
`transitionTimingFunction` scales in `tailwind.config.ts` are **replaced**,
not extended.

Tailwind therefore emits no class for a value the system does not name.
`text-[13px]`, `rounded-xl` and `shadow-sm` produce no CSS. `borderRadius`
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
bg-raised   chrome on the canvas — topbar, document header
bg-sunken   navigation rails — primary nav, knowledge sidebar
bg-subtle   inset fills — code blocks, table headers, kbd
```

Names say what a surface is, not where it was first used. The previous names
(`reading-bg`, `bg-nav`, `bg-sidebar`) are why a warm grey and three cool ones
ended up adjacent without anyone noticing.

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
surface uses it. There is no second spelling.

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

## 11. Navigation state

A view returns to where it was left, not to the top. Scroll position is
remembered per view and restored on return; going somewhere new still starts
at the top, and a hash target is left alone so in-page anchors keep working.

What the user has arranged is theirs to keep. Filters, expansion and
collapsed sections belong in the URL when they should be shareable, and in
`localStorage` when they are a personal preference — not in component state
that a refresh discards.

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

Every form field is `Input`, `Select` or `Textarea`, which share their shape
through `fieldClasses()` in `components/ui/field.ts`. `Select` is a native
`<select>`: the search page is a plain GET form that works without JavaScript,
and every hand-rolled copy it replaces was native already. A multi-line field
takes its height from `rows` rather than the ladder; only its padding scales.

### One loading idiom, one message shape

A region that is loading shows a skeleton shaped like what is being fetched,
paired with a screen-reader-only `role="status"` line, because a skeleton is
`aria-hidden` and on its own announces nothing. Prose such as
`Loading documents…` is not a second option. The skeletons live in one module
per area rather than beside a caller: the document skeleton had two callers,
was copied into both, and the two drifted to different paddings, so the page
shifted as the route boundary handed over to the `Suspense` fallback.

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
covers why, and it is open item 6.

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

Each of these changes behaviour rather than appearance:

1. `⌘K` executes search only. The reference language treats it as a command
   palette; creating a note, toggling archived and opening Details have no
   keyboard path and no discoverable shortcut list.
2. No toast or undo layer. Feedback is `role="status"` text that shifts
   layout, and destructive actions confirm inline rather than acting and
   offering undo. (The announcement itself works — `role="status"` carries an
   implicit `aria-live="polite"`. An earlier wording here counted literal
   `aria-live` attributes and read as though nothing were announced at all,
   which overstated the gap.)
3. Settings navigation does not use the `ui/tabs` primitive and has no active
   state. `ui/tabs` wraps Base UI's client-side tabs, which route-based
   navigation cannot use directly, so this wants a link-based tab bar sharing
   the tab classes — a decision, not a mechanical change.
4. Empty and error states are heading-plus-paragraph, and the knowledge empty
   state presents two equally weighted primary actions. `StatusMessage` (§15)
   gives them one shape; it does not give them illustration, guidance or a
   ranked action.
5. No row carries a context menu. Renaming, archiving and copying a link all
   require opening the document first, where the reference language puts them
   one right-click away on the row.
6. Tree expansion and the tree filter live in component state, so a refresh
   discards the arrangement the user set. §11 says where they belong.
7. Navigation is a server round trip, so opening a document shows a skeleton
   first. This is the largest felt gap against the reference language and the
   only one that is architectural rather than presentational — it wants
   measurement and a prefetch/caching decision, not a CSS change.
8. `spacing` is the one scale still left at Tailwind's default rather than
   replaced, so gaps and paddings remain unenforced. Page container widths
   spread across seven values and page padding across three.
9. Timestamps are formatted in the runtime's own time zone, which differs
   between the server render and the client render. The locale is settled
   (§15, one module); the zone is the same product decision the locale was —
   resolve it server-side, or render these client-side only.

## 19. Completion criteria

- Off-scale type, radius, elevation and motion values do not compile.
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
