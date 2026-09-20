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
| Radius | `sm`, `md`, `lg` | see §5 |
| Elevation | `popover`, `modal` | floating surfaces only |
| Border | `border`, `border-strong` | see §6 |
| Motion | two durations, one easing curve | see §9 |

## 5. Radius

Three tiers:

- `sm` — inline chrome: `kbd`, inline code, badges. These sit inside a text
  line and take the control radius badly.
- `md` — controls, rows, panels, sections. The default.
- `lg` — **floating surfaces only**: dialogs, drawers, dropdowns, popovers.

`lg` appearing on a panel is a bug. The rule is checkable by grep, and that is
the point of stating it this way.

Large SaaS-style rounding — uniformly heavy radii on ordinary cards and panels
— is avoided.

### Divergence from the original §26

The Phase 2.5 text specified two tiers, `4px default / 6px interactive,
floating surfaces`. This contract uses three, with floating surfaces above
6px.

The accompanying instruction, "avoid large SaaS-style rounding", targets
uniformly heavy rounding on ordinary panels; it is not an argument against
tiering. The reference language this product follows tiers its own radii:
small on controls, larger on floating surfaces. One small radius shared by a
32px button and a 640px command palette reads as undersized on the latter.

The substituted rule is narrower and enforceable, which the original was not.

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
  only thing separating it from its background, which today means `Input`,
  `Textarea` and the `secondary` button (all of which fill with `bg`, the
  canvas colour). WCAG 1.4.11 requires 3:1 for non-text boundaries that
  identify a component, and a decorative divider cannot meet that and stay
  decorative.

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

## 8. Colour

One restrained accent, used for selected state, focus, primary action and
active navigation. Hierarchy relies on weight, size, spacing and muted
foreground rather than decorative colour.

Semantic colours carry meaning only. Each of success, warning and danger has a
text colour, a tinted background and a border, so status is scannable at a
glance rather than distinguishable only by reading.

`--kh-danger` is split into a text colour and a solid surface. A filled
destructive button needs a mid red that holds white text; danger text on a
dark background needs a light red. One token cannot serve both once a dark
theme exists.

No component declares a colour outside the token layer.

## 9. Typography and motion

UI text is approximately 14px; document body 15–16px.

The typeface is loaded, not inherited from the platform — the default sans
varies most at the 11–14px sizes this UI lives in. Timestamps and figures that
re-render in place or stack into columns use tabular numerals.

Motion is two durations and one ease-out curve. Overlays enter and leave;
nothing appears instantly. `prefers-reduced-motion` is honoured by one global
rule, so no component has to remember it.

## 10. Focus

One idiom: the ring, composed from `.kh-focus-ring`. Every interactive surface
uses it. There is no second spelling.

## 11. Theme contract

Light and dark must both resolve every token.

Dark is served by two selectors carrying identical values: a
`prefers-color-scheme` media query for visitors who never touch the control,
which also works with JavaScript disabled, and a `data-theme` attribute for an
explicit choice. Plain CSS cannot share a variable block across that boundary,
so the duplication is deliberate and the two blocks are edited together.

An explicit choice persists to `localStorage` under `kh:theme`. A pre-paint
script in the document head applies it before the first frame.

## 12. Icons

A consistent outline icon language (Lucide). In primary navigation, icons
support labels rather than replace them.

## 13. Frontend technology

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

## 14. Component architecture

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

## 15. State strategy

No Redux, Zustand or other application-wide state framework.

```text
URL              → Workspace / Source / Document
Server data      → Workspace / Source / Tree / Document / Revision / Import state
Local component  → Tree expansion, tree filter, inspector open, drawer state
```

A global state library is added only if a concrete requirement proves local
ownership insufficient.

## 16. Domain contract boundary

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

## 17. Open items

Known gaps against the principles in §2, each of which changes behaviour
rather than appearance:

1. `⌘K` executes search only. The reference language treats it as a command
   palette; creating a note, toggling archived and opening Details have no
   keyboard path and no discoverable shortcut list.
2. No toast or undo layer. Feedback is `role="status"` text that shifts
   layout, and no `aria-live` region exists. Destructive actions confirm
   inline rather than acting and offering undo.
3. Settings navigation does not use the `ui/tabs` primitive and has no active
   state. Page container widths are inconsistent across four values.
4. Empty and error states are heading-plus-paragraph, and the knowledge empty
   state presents two equally weighted primary actions.

## 18. Completion criteria

- Off-scale type, radius, elevation and motion values do not compile.
- The `lg` radius and both elevation tokens appear only on floating surfaces.
- No component declares a colour outside the token layer.
- One focus idiom across the codebase.
- Light and dark themes resolve every token.
