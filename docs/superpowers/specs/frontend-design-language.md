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

Tailwind emits no ordinary utility for a value the replaced scales do not name:
`p-7`, `shadow-sm` and `text-xl` produce no CSS. `rounded-xl` is a valid 12px
radius token. Tailwind still compiles arbitrary values, including `text-[13px]`;
replacing a scale does not disable that feature.

ESLint `design/contract` rejects arbitrary type, radius, elevation, motion and
spacing utilities in both literals and template strings. Widths/heights/insets
used for pane geometry, viewports and truncation may be arbitrary. Native form
fields must use Input/Select/Textarea; hidden pickers, native checkboxes and
radio controls are allowed. Unframed composer, palette, tree-filter and move
search surfaces are explicit exceptions in `scripts/eslint/design-contract.mjs`.
New exceptions require a concrete reason here and in the rule.

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
| Syntax colour | `--kh-syntax-{keyword,string,number,comment,function,type,variable,meta}` | fenced code in the reader and on a shared page; see §8 |
| Chart colour | `--kh-chart-1`, `--kh-chart-1-hover`, `--kh-chart-2`, `--kh-chart-3` | series marks in data displays (Insights); see §8 |
| Container | `page`, `wide`, `reading`, `panel` | see §7; the `maxWidth` scale is replaced, so `max-w-4xl` does not compile |
| Spacing rhythm | `0`, `px`, `0.5`–`6` every half step, `auto` (margin), `16` (padding) | paddings, margins and gaps; `16` is `StatusMessage` and `EmptyState` only, see §7 |
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

`PageHeader`'s line is 48px and is the first thing on its page: a page that
opens with one has no top padding (`pb-6`, not `py-6`), so the line is centred
on the same top line as the rail's wordmark row and a document's breadcrumb —
with no topbar, that line is the window's top edge. A page that does not open
with `PageHeader` keeps `py-6`. `py-8` appeared on four sources pages for no
reason anyone recorded. The `py-16` of a centred message state belongs to
`StatusMessage` and `EmptyState`, not to the pages that show one.

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

One restrained accent, used for selected state, focus and primary action.
The primary rail's current item is not one of them: it is marked with a neutral
step above hover (`bg-hover-strong`, full-strength text, medium weight), so the
accent on screen is the explorer's selected document rather than two accent
blocks side by side competing for the eye. Hierarchy relies on weight, size, spacing and foreground
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

### Syntax colour

Fenced code is coloured from eight tokens, `--kh-syntax-` plus `keyword`,
`string`, `number`, `comment`, `function`, `type`, `variable` and `meta`,
declared for both themes next to the rest of the palette. The rules that put
them on the highlighter's classes (`.hljs-*`) are in `globals.css` and use
`var(--kh-syntax-*)` and nothing else; a colour written into one of those rules
is the same drift as a colour written into a component.

They sit on `bg-subtle`, the code block's own surface, and each meets **4.5:1**
against it in both themes — the bar for text, since code is read, not glanced
at. That is checked by `tests/unit/syntax-colors.test.tsx` from the stylesheet
itself, so changing a value until it fails is caught before it ships. The same
test holds the two colours the diff rules borrow, `--kh-success` and
`--kh-danger`, to the bar on that surface.

Not everything is coloured. Operators, punctuation, parameters and the wrappers
around other scopes keep the block's text colour: colouring every scope colours
nothing. A scope the highlighter starts to emit that has neither a colour nor a
reason to be left plain fails the same test, which is how a lowlight upgrade
announces itself.

The rendered editor's code blocks are not coloured (daily-driver spec §5);
they are the editor's, and its decorations are a different piece of work.

### Chart colour

Data displays draw their series from four tokens, declared for both themes
next to the rest of the palette:

```text
chart-1        slate blue  — the primary series (daily reading)
chart-1-hover  one step deeper (light) or lighter (dark), for the column under the pointer or focus
chart-2        dusk mauve  — the first categorical series (synced folders)
chart-3        sage        — the second categorical series (personal notes)
```

They are deliberately muted and sit apart from the accent. A chart is read
alongside chrome that already uses the accent for selection and focus; a
series in the accent would read as selected. Saturation is held low so a bar
never outranks the number it illustrates.

Each meets **3:1** against `bg` and `bg-subtle` (the track an unfilled bar sits
on) in both themes, the WCAG 1.4.11 bar for graphical objects. They are not
text colours and do not meet 4.5:1 everywhere; a label is never set in one.
`tests/unit/chart-colors.test.ts` checks both from the stylesheet.

`chart-2` and `chart-3` differ by hue, not lightness (about 1.05:1 between
them), so colour alone cannot tell the two series apart for every reader.
Every chart that shows more than one series therefore names each in text — a
legend with the value beside it, as Insights' composition bar does. A new
chart that cannot carry such a legend needs a distinction in form (pattern,
gap, position), not a fourth colour.

A single series split into part and whole (Insights' folder bars: documents
viewed, of documents in the folder) draws the whole in the series colour at 35%
opacity and the part at full strength. The tint is below 3:1, so the bar is
never the only carrier: the "n of m" figure sits beside it in text.

They were first written as values local to Insights' stylesheet, outside the
token layer, and promoted here unchanged. A component reads them as
`var(--kh-chart-*)` and declares no series colour of its own.

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
the same thing, and is the hint shown beside the action in the palette and in
the row menu (`shortcutLabel`), so the three cannot disagree. Adding a shortcut is filling
that field.

**A control with no visible label names itself in a `Tooltip`, not in `title=`**
(`components/ui/tooltip.tsx`, Base UI's Tooltip). The native tooltip waits about
a second, cannot be styled, and never appears for a keyboard user or on touch;
this one opens on hover and on keyboard focus, at the `lg` radius and `popover`
elevation (§5, §6), and shows the control's shortcut as a `Kbd`. The shortcut is
passed as the registry's `shortcut` value, the same string that binds the key
and fills `aria-keyshortcuts`, so the tooltip cannot say a key the control does
not have. A shortcut that is not in the registry (the graph's `+`, `−`, `0`) is
passed as `keys` and read as written. The control keeps its own `aria-label`;
the tooltip is a hint, not a name. Three things keep the native `title`: text
that is truncated (the title is the rest of the string), a timestamp's exact
time, and a disabled control whose title says *why* it is disabled — a disabled
button receives no pointer events, so a tooltip over it would never open. A menu
trigger takes no tooltip either, since it would sit on the menu it opens.

A single key (for example `C`, `E`, `F`, `M`, `R`, `/`) is also a character, so it acts only when
`isSingleKeyShortcut` in `lib/shortcut-keys.ts` says so: no `⌘`, `Ctrl` or
`Alt`; not mid-composition in an input method (a letter typed while composing
Chinese is text, not a command); not inside a field, a dialog, a menu or a
listbox; not a key repeat; and no Shift, except for `/`, which some layouts
only type with it. Keys are compared by `event.key`, what the reader sees on
the keycap, not by position.

Single keys act on the row in focus, and on the document being read when no
row is. The tree (`knowledge-tree.tsx`) takes the keys `rowShortcuts` declares
for the kind of row it is on (`E`, `F`, `M` for a document; `C`, `M`, `R` for a
folder), runs the row's own action for it, and takes the key even where the
registry offers the row nothing, so `E` on a read-only row does nothing and
does not edit the document being read. A folder row also takes the document
keys (`E`, `F`), because with no row in focus they act on the document being
read and must never fire for a folder. A document row does not take `C`: it
is left to the page, where it is still Create document. The page's listener
(`quick-search.tsx`) binds the rest from the actions the palette lists, so with
no row in focus `E`, `F` and `M` act on the document being read, when the
registry's three availability axes allow it. `j` and `k` are the arrows' other
spelling inside the tree. The row menu shows each action's key: it is opened
from a row, and the key does that thing when that row has the focus. Row keys
spec: `docs/superpowers/specs/2026-10-02-row-keyboard-actions-design.md`.

In the document composer (new and edit share it), ⌘Enter saves through the
form's own submit button, and only when that button is enabled. ⌘/ switches
between the rendered editor and the Markdown source; the source is the
default's opposite, a keystroke away. `Esc` leaves only a composer nothing has
been typed into, and with changes it does nothing. No key discards a draft;
Cancel is the one way to, and it asks first. ⌘K stays the global search and the
editor does not bind it. The editor does bind ⌘B and ⌘I for its text; ⌘I is
also the reading page's Open details, and the editing page has no such panel.

⌘\ (Ctrl \ elsewhere) collapses and expands the primary navigation, and is
`NAV_TOGGLE_SHORTCUT` in the registry: the app shell reads the key from there,
the collapse button takes its `aria-keyshortcuts` from there, and the palette's
"Toggle navigation" shows it (`matchesShortcut` in `lib/shortcut-keys.ts` reads
a shortcut that carries a modifier, as `isSingleKeyShortcut` reads one that
does not). It acts from the composer's title and editor, since no field types
it — the writer is who most wants the room — but a dialog or menu that is open,
the palette included, keeps its keys. Where the rail is not on screen (a window
under `lg`) it opens and closes the menu that takes its place. It is not ⌘/,
which the composer has for the rendered/source switch, nor ⌘B, which is bold
there. The Knowledge explorer beside it has no collapse, so this does not reach it.

The composer's title field, its rendered editor and its Markdown text are the
one place without the focus ring. A text field matches `:focus-visible` for as
long as it has focus, so a ring would frame the whole canvas for the whole time
anyone writes; the caret is the focus indicator there. Its buttons keep the
ring. Composer spec §6.

**A link to the page being read does not prefetch** (`prefetch={false}` on
the selected row in the tree and in Favorites/Recent). Prefetched from itself,
the page comes back whole rather than cut at its loading boundary, and the
router applies a prefetch's content on its first use however old it is. The
return from a save is that first use, so the reader landed on the revision
before the one just saved, until a reload. It showed only when the editor was
entered by client navigation (palette, row menu, `E`); a full load into the
editor starts with an empty router cache, which is why every earlier test,
all entering through the header's plain link, passed.

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

**A row in a menu shows focus as its fill, not as the ring.** This is the second
place without the ring, after the composer's text (below), and for a different
reason: Base UI moves focus to the row in force and marks it `data-highlighted`,
for the pointer and the keys alike, so the hover fill already *is* the focus
indicator. With the ring as well, a row reached by arrow key was drawn twice, a
fill inside a 2px accent frame, and was the loudest thing on the surface. The
reference shows the fill alone. The cost is stated rather than hidden: the fill
is a quiet step against the popup, and a keyboard reader has less to see than
the ring gave. `SelectMenu`'s rows are the same rows. The trigger that opens a
menu keeps the ring.

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

**A row's menu is grouped by what the reader is doing**: open, change, export,
remove, in that order, with a rule between sections. Remove is last and alone,
because Archive and Restore are what looks hardest to take back and a menu keeps
those where a stray click is least likely to land. The sections follow a
`section` field on the registry's row actions; the palette keeps its own
`group`, which answers a different question (what the action is *about*), and
neither field stands in for the other. A rule is drawn only between two sections
that both have something in them, so a row the reader may only read never
begins, ends or doubles up on a rule. *Open document* is not offered on a row:
the row is a link, so a click or Enter already opens it, and it was the only item
that duplicated a gesture rather than adding one. *Open in new tab* and *Copy
link* stay, for the reason above.

That trigger is floated over the row's own background rather than given a
column of its own. A second reserved control slot re-truncates every label in
the tree to buy a button that is invisible most of the time; a float costs
nothing when hidden. It follows that a row holding a floated control must have
a background whenever that control is showing, which is why
`.kh-interactive-row` tints on `focus-within` as well as on hover.

### The `[[` list

The one floating list that is not a menu: it opens under the caret while a
wikilink is being typed (`editor/wikilink-suggest.ts`, daily-driver spec §6).
It takes what a menu takes — the `lg` radius, a border, the `popover`
elevation, the selected row in `kh-bg-selected` —
and its own colour is all in tokens (`.kh-wikilink-suggest` in `globals.css`;
`tests/e2e/zz-composer-autocomplete.spec.ts` resolves the tokens and compares,
in both themes).

What differs is that focus never leaves the document. It is therefore not a
Base UI menu, whose whole point is to take focus: the editor becomes a
`combobox` while the list is open and points at the row in force with
`aria-activedescendant`, and the keys are the editor's (`handleKeyDown`, before
its own keymaps). It is drawn on `document.body`, `fixed`, so no scrolling
ancestor clips it, and it sits under the line it belongs to — above it when
there is more room there, and scrolling rather than covering the line when
there is room on neither side. Its count is announced by a live region of its
own: the page's one `role="status"` is the toast layer's.

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

### Brand mark

The product has one mark: a hub joined by three uneven links to three
satellites of three sizes. It is filled and round where the interface icons
are outlined and thin, so it does not borrow Lucide's weight. Its proportions
are deliberately full (a large hub, short heavy links) so it holds at 16px.

Today it appears only as the browser-tab icon, `src/app/icon.svg`. The topbar
keeps the wordmark alone. A favicon cannot inherit a colour, so the file
carries `text` for each scheme in a `prefers-color-scheme` query;
`tests/unit/brand-mark.test.ts` fails if those colours leave `--kh-text`.
It is never used for an action.

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

**A dialog takes its surface from `components/ui/dialog.ts`.** The modal
surface (`xl`, `modal`, the one enter and leave) was spelled out in six places:
five dialogs and the command palette. `dialogPopupClasses()` is a centred
dialog and takes only its width; `dialogSurfaceClasses` is the surface alone,
for the palette, which is placed and padded differently. `Dialog` and
`AlertDialog` are different roots, so it is the look that is shared, as with
tabs.

**A button says what state it is in.** Hover, pressed, and "my menu is open"
are three states. The neutral variants (`ghost`, `secondary`) take the step
above hover while pressed (`bg-hover-strong`) and keep the hover fill for as
long as the menu they opened is showing (`data-popup-open`), so a menu never
hangs off a trigger that looks idle. No variant's hover may equal its rest:
`soft` shipped that way, and now deepens to `highlight`, the one accent tint
above `bg-selected`. No colour token was added or changed for any of this.

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

Every form field is `Input`, `Select`, `SelectMenu` or `Textarea`, which share
their shape through `fieldClasses()` in `components/ui/field.ts`.

**A choice among options has two spellings, and which one is decided by whether
the form must work without JavaScript.** `SelectMenu`
(`components/ui/select-menu.tsx`, Base UI's Select) is the default in a client
component: closed it is a field, open it is a menu, with the popup and rows of
`ui/menu.tsx` (`lg`, `popover`, rows on the control height), opening under the
field. A native `<select>` gives its list to the platform, so the design
language stopped at the moment the control was used; twelve such fields in
settings, imports, the graph and the share dialog were native for no reason
beyond having been written that way. It reports through `onValueChange` and has
no `name`. It has no filter field; one is added when a list outgrows type-ahead.

`Select` stays a native `<select>`, for a form that submits by GET: the search
page, the Updates source filter and the shares status filter. For the first of
those: the search page is a plain GET form that works without JavaScript,
and every hand-rolled copy it replaces was native already. With JavaScript,
that form searches as the reader types and its submit button goes
(`LiveSearchSubmit`); the URL is still the state, so a search stays
shareable, and without JavaScript the button and the GET remain. A multi-line field
takes its height from `rows` rather than the ladder; only its padding scales.

**A field has a name, and one way to be wrong.** `Label` (`components/ui/label.tsx`)
is the name: above a field it is `body-sm`, medium, `text-secondary`; beside a
control in a toolbar (`inline`) it is a `caption` in `text-muted`. The primitive
existed and nothing used it, and twenty-four labels were spelled a dozen ways,
most of them at body size in the primary colour, where a name read as a value.
A label on a checkbox or radio row is the row and stays its own; a `sr-only`
label is not seen. A field marked `aria-invalid` takes `danger` on its border,
from `fieldClasses()`: three fields set the attribute and looked no different.
The message still sits beside the field (see Feedback, below); the border says
which field. `Textarea` is set in the interface face; a field for paths or
Markdown asks for `font-mono` itself. It had been monospace for every caller,
including the one that asks what went wrong.

**A disclosure and a checkbox stay native, and are drawn.** `<details>` opens
without script and a native checkbox keeps its checked state, its keys and its
label's click; neither is rebuilt. What the platform drew is replaced, by two
element rules in `globals.css`, so that no call site can be without them:

- `summary` loses the platform's triangle and gains the icon set's chevron,
  which turns a quarter as the disclosure opens (§9's short duration). Nineteen
  disclosures each showed the browser's own marker. Every `summary` carries the
  focus ring; two did not, and a test now reads the sources for it.
- `input[type="checkbox"]` is a 14px box at the `sm` radius: `border-strong`
  while empty, since the border is all that says a control is there (§6), and
  the primary fill with a check in `on-primary` once ticked. `accent-color` on
  the platform's box is gone; it coloured a shape that was still the operating
  system's. The editor's task marker is the same box, where it had been the
  glyphs `☐` and `☑`.

Both glyphs are masks over a colour token, from files in `public/icons`, for
the reason the select's chevron is a gradient: `img-src 'self'` refuses `data:`
images (§13).

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

### A state is a glyph and a word; an empty place leads with its action

`components/ui/status.tsx` says a state with a glyph, a colour from the semantic
tokens, and the word beside it: a sync that succeeded, one that failed and one
that is only previewed used to be the same grey sentence, so a list of sources
could only be scanned by reading it. Only the glyph is coloured; the word keeps
the surrounding text colour, which is what makes colour a second channel rather
than the only one (WCAG 1.4.1). `archived` and `none` are muted on purpose — an
archived document is a lifecycle state, not a problem. `Badge` stays for chrome
that is a label rather than a state (a source's type).

`components/ui/empty-state.tsx` is the shape of a place with nothing in it, and
is not `StatusMessage`. That one is an error or a not-found — something went
wrong, here is the way out — and sits left-aligned like the page it replaced. An
empty list is where the reader starts: it is centred, has an icon, **names the
state ("No documents yet") and never the page**, and leads with one primary
action. A second action is secondary, so two equal buttons never ask the reader
to choose. `hint` teaches the one shortcut that does the primary action, because
the empty state is the one moment a reader is looking for what to do. Compact
empty lines inside a rail or a list (a folder with nothing in it) stay one line
of `text-muted`; they are not pages.

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

### A feature that is announced and not open is a disabled row that says so

Team workspaces exist and are not yet offered. The workspace switcher does not
hide the place where they will be, and does not list them as if they could be
entered: it shows one disabled row, "Team workspaces", with "Coming soon" on it,
and nothing that leads to one (no team names, no "Archived" submenu, no "Create
team"). A reader is told the feature is coming and is not offered something
that would go nowhere. The disabled row carries its own explanation as text,
not only as a tooltip, which only a pointer reaches.

What this decides is what the switcher *offers*. It is not access control and
must not be read as one (`docs/operations/team-workspaces-availability.md`): a
link into a Team workspace still opens it, and the services' rules are the same
whether the flag is on or off. A test holds both halves — that the closed
switcher offers nothing, and that a link still works — so that nobody takes the
first for the second.

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
*here* — except one that says its own action is what navigates: archiving the
document that is open sends the reader to the list, and the Undo has to be
there when they arrive. Such a toast survives the navigations of the next few
seconds, plural because one push can be several (the router changes the
address to the route it was sent to, and that route redirects), and a later,
unrelated navigation clears it as usual.

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

**A refusal that says nothing about access does not re-check it.** A failed
request that might mean the caller's access changed makes the shell re-check
it, and while it does every mutation is paused and "Unable to confirm
workspace" is shown. That is the right price for a 403 and the wrong one for
"this folder is not empty": the caller can still do everything they could a
moment ago. Conflicts about content — a stale revision, a full share-link
list, a folder that is not empty, a parent that is archived, a move into
itself — are excluded in `requestWorkspaceAccessCheck`, and a test holds each.

**A key that moves a row is announced in a live region, not in a toast, and
the live region is not `role="status"`.** After Alt+↑/↓ the tree says where the
row is now ("Moved “B” up. Position 1 of 3.") in an `aria-live="polite"` region
it owns, remounted per message so the same words twice are heard twice. The
toast layer is the page's one `status`; a second would make every "find the
status on this page" query — the e2e suite has several — ambiguous.

**A choice among places is a native radio group, with its label as the target.**
The Move dialog lists the top level and the folders as `<input type="radio">`
visually hidden (`sr-only`, and `relative` on its label so it stays with it) and
a label that carries the row's look through `has-[:checked]`, `has-[:focus-visible]`
and `has-[:disabled]`. The arrow keys, the group's one tab stop and the
checked state are the browser's; a custom listbox would have had to rebuild all
three. Where a place cannot be chosen (where the item already is) the radio is
disabled and the row says "Current". Tests click the label, as a reader does:
a forced click on the hidden input lands wherever the pixel is.

**A mutation that navigates to its result refreshes on arrival.** The push
fetches the destination page fresh, but a layout the two routes share is kept
as it was: saving a title left the knowledge sidebar naming the document by
its old one until a reload. `router.refresh()` renders the layouts again, but
never in the same breath as the push: a navigate dispatched while a refresh is
pending discards it, and a refresh sent alongside a push was measured leaving
the reader on the editor (#49). So the mutation calls `refreshOnArrival(href)`
before pushing, and the destination (`useRefreshOnArrival` in
`components/shell/refresh-on-arrival.ts`) refreshes once it has mounted, when
there is no navigation left to race. Saving and creating a document both work
this way.

**Undo is offered only where a reverse operation already exists.** An "Undo"
that cannot restore the previous state is a lie. Archiving a workspace,
renaming it, granting access, changing a role and revoking a grant all qualify,
and so do archiving and restoring a document or a folder, renaming a folder,
and moving a document or a folder through the Move dialog (back to the folder
and the place it came from): ARCHIVED is a lifecycle and not a deletion, so the
document keeps every revision and its place, and restore is the reverse. A step
made with Alt+↑/↓ gets no Undo toast — its reverse is the step the other way,
and a toast for every key press would bury the tree — and is said aloud
instead (below). Creating a folder does not:
the nearest thing to taking it back is archiving it, which is not the same.
Editing a document does not:
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

Where one is kept it is `ConfirmDialog` (`components/ui/confirm-dialog.tsx`,
Base UI's AlertDialog), never `window.confirm`: the native one cannot be themed,
holds the page's JavaScript thread while it is up, and reads differently in
every browser. It is the modal surface (`xl`, `modal`), and **the safe answer
holds focus** — Cancel is first and takes it, so Enter on a dialog that has just
opened never confirms by reflex; Escape and the backdrop both mean no. Its
confirm button names the act ("Discard changes"), not "OK". A dialog inside a
form is rendered beside it, not in it: React events bubble through a portal to
the component that rendered it, and the form's keys are not the dialog's. The
composer's Cancel is the first user, and the draft is still cleared only on the
discard answer.

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
                   Personal drafts and account favorites
Persisted local  → Scroll position, nav collapse, theme, recent reads, and the
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
of thing a reader trusts: **archiving a document and copying a link did not
exist in this product when it was written.** The item said a context menu was
missing for three actions when two of the three had never been built. Copying
a link was built with the menu. Archiving was the other half, and it was never
a domain change: the domain had always had it (`archiveDocument`,
`archiveFolder` and their restores in `HubKnowledgeCommandService`), and what
the web lacked was an entry. That is now added (daily-driver spec §7), and the
registry took it as this paragraph said it would, as entries rather than a
redesign — with one thing it had not carried, the state of the source apart
from the state of the document: an archived source's documents read as
archived and cannot be restored until the source is. Archiving turns the links
that pointed at a document into unresolved ones, because links resolve only to
active documents; the confirmation says how many, in words. Restoring heals
them, since resolution is read at read time and nothing was rewritten.

The 2026-09-30 personal rollout adds document/folder organization through the
existing Hub commands, Markdown downloads, revision restoration, persistent
personal drafts and account favorites. The personal rollout spec supersedes
the earlier deferred-product decisions on these operations. Team navigation
remains visible but disabled, labelled Coming soon, until server configuration
explicitly enables it. Disabled controls have no navigation or click action.

1. The palette is mostly navigation, and that is a product gap rather than a
   UI one. Counted against the code it can offer about fourteen entries, of
   which the majority are ways to get somewhere; a command palette does not
   create commands. Worth revisiting when this product has more a reader can
   do, not by adding entries that do nothing. (2026-09-29: two entries were
   added for real product behaviour — Open graph and Show backlinks — which is
   the kind of addition this item asks for; the count is about sixteen, still
   mostly navigation.)
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
 3. Editing was a different page from reading. Closed: the document composer
    (`docs/superpowers/specs/2026-09-28-document-composer-design.md`) edits
    in the reader's layout on the same `/edit` and `/new` routes. The title
    follows the content (metadata title, then the opening H1, then a typed
    field), the document is edited rendered with its Markdown a toggle away,
    and the navigation guard this item asked about became a tab-scoped draft
    restored on return, since the App Router cannot intercept in-app
    navigation. Personal workspaces now save drafts to the account separately from published revisions, with a local recovery copy and visible save status; Team drafts remain tab-scoped.
 4. Knowledge pages carry two sidebars side by side: the primary nav
    (`src/components/shell/app-shell.tsx`, `w-40`, collapsible to `w-12`)
    and the Knowledge explorer (`src/components/knowledge/source-sidebar.tsx`,
    `w-72`). The reference has one. Merging them changes the shell every page
    sits in, so it comes after item 3.
 5. One thing is deferred on purpose, with the condition that reopens it. List
    pages sit in `kh-page` rather than spanning the window; widen them when the
    Sources list is long enough that the width costs a reader something. (`E`
    acting only on the document being read, not on the focused row, was the
    other half of this item; it closed when rows gained keys a reader reaches
    by focus: `docs/superpowers/specs/2026-10-02-row-keyboard-actions-design.md`.)

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

## October 2026 remediation

Desktop navigation keeps a 160px primary rail, collapsible to 48px, beside an independent 288px contextual explorer. Wide screens have no topbar: rail, explorer and content all start at the top of the window, and the explorer retains its full height when the primary rail collapses. The primary rail opens with the wordmark and its collapse control, then the workspace switcher, then a Search row drawn like navigation. The reader pins its breadcrumb line (location › title, with Edit/Share/Details) to the top of the reading column while the rest of its header scrolls away. A pinned bar's lower edge is not a rule: while it is pinned, the content scrolling under it fades into it through a 16px gradient from `--kh-bg` to transparent (`.kh-fade-below`, in `globals.css`), drawn below the bar, click-through, and never taller than would swallow a line of text. The composer's pinned command line uses the same edge. The rule is for a page's pinned *top line* over reading or writing; a sticky table header and a pinned bottom action bar keep their rule, which separates a header from its rows and an action bar from the form it acts on. On a document page the rail's first row (wordmark), the explorer's first row (Documents) and the document's breadcrumb line are each 48px and centred on one line, so the three columns share one top edge. Narrow screens keep a topbar (Menu, search icon, and the document's title and actions once its header scrolls away) and one Menu drawer headed by the switcher (`2026-10-08-workspace-switcher-in-rail-design.md`). Reader/composer share DocumentPane geometry and the composer pins Save/Cancel/Markdown and draft status inside its scrolling pane. See `2026-10-02-linear-remediation-design.md` for the coordinated contract. Kbd and graph action hints use `text-muted` to meet small-text contrast. Desktop controls retain 24/32/40px heights; coarse pointers get at least 40px physical targets through the shared control classes.
