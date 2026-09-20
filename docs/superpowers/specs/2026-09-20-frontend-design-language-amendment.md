# Knowledge Hub — Frontend Design Language Amendment

| Item | Value |
| --- | --- |
| Date | 2026-09-20 |
| Type | Frontend design amendment |
| Parent design | `docs/superpowers/specs/2026-09-13-phase-2.5-frontend-product-baseline-design.md` §25–28 |
| Scope | Design token contract and its enforcement mechanism |
| Status | Implemented in working tree |

## 1. Goal

Phase 2.5 §25–28 adopted a Linear/GitHub-inspired workbench and named the
visual tokens it should use. The rules were written but never made
enforceable, so the implementation drifted from them: nine type sizes against
a stated two, five radius spellings against a stated two, shadows on
non-floating surfaces the parent design excludes, two competing focus idioms,
and four near-identical surface greys mixing warm and cool hues.

This amendment does not restate §25–28. It records two things the parent
design does not cover:

1. **How the token contract is enforced**, so the next drift fails the build
   instead of passing review.
2. **One deliberate divergence** from §26's radius rule, with its rationale.

Token *values* live in `tailwind.config.ts` and `src/app/globals.css` and are
not duplicated here. A second copy of the numbers would be a second source of
truth, which is the failure this amendment exists to close.

## 2. Non-goals

- Restating the principles in §25. They stand unchanged.
- Changing §27 (Base UI + Tailwind + KH tokens) or §28 (component
  architecture). Both stand unchanged.
- Product behaviour. Command palette actions, toast/undo, settings navigation
  and empty-state treatment are named in §8 as open, not delivered here.

## 3. Enforcement Contract

The `fontSize`, `borderRadius`, `boxShadow`, `transitionDuration` and
`transitionTimingFunction` scales in `tailwind.config.ts` are **replaced**,
not extended.

Tailwind therefore emits no class for a value the system does not name.
`text-[13px]`, `rounded-xl` and `shadow-sm` produce no CSS, and `borderRadius`
carries no `DEFAULT` key, so a bare `rounded` does not compile either.

This is the substantive change. §26 stated the rules; this makes them
non-optional. A contributor cannot introduce an off-scale value without
noticing, and a reviewer no longer has to catch it by eye.

## 4. Scale Shape

Named here for vocabulary only; the values are in `tailwind.config.ts`.

| Scale | Tokens | Notes |
| --- | --- | --- |
| Type (UI) | `micro`, `caption`, `body-sm`, `body`, `title`, `heading` | `body` is §26's ~14px UI text |
| Type (document) | `reading`, `display` | `reading` is §26's 15–16px document body |
| Radius | `sm`, `md`, `lg` | see §5 |
| Elevation | `popover`, `modal` | floating surfaces only, per §26 |
| Motion | two durations, one easing curve | |

Surfaces are four steps of one cool hue, each with a single job: `bg`
(canvas), `bg-raised` (chrome on the canvas), `bg-sunken` (navigation rails),
`bg-subtle` (inset fills). The previous names said where a colour was first
used rather than what it is, which is how a warm grey and three cool ones
ended up adjacent.

## 5. Divergence: overlay radius

§26 specifies:

```text
4px default
6px interactive/floating surfaces
```

This amendment uses three tiers instead of two: `sm` for inline chrome (`kbd`,
inline code, badges), `md` for controls, and `lg` for floating surfaces —
dialogs, drawers, dropdowns and popovers — at a value larger than 6px.

**Rationale.** §26's accompanying instruction is "Avoid large SaaS-style
rounding", which targets uniformly heavy rounding on ordinary cards and
panels. It is not an argument against tiering. The reference language the
parent design adopts tiers its own radii: small on controls, larger on
floating surfaces. A single small radius shared by a 32px button and a 640px
command palette reads as undersized on the latter.

The rule this amendment substitutes is narrower and checkable: **`lg` is the
overlay radius and appears only on floating surfaces.** Panels, sections and
rows use `md`. At the time of writing, `lg` appears on four elements, all of
them floating.

`sm` is not a third decorative tier. It exists because inline chrome sits
inside a text line and takes the control radius badly.

## 6. Corrections to prior implementation

Applied here, each a violation of §26 that predates or was introduced during
this work:

- Shadow removed from `ui/textarea`. §26 excludes shadows from normal
  application surfaces; the border already carries the structure.
- Panels and sections in settings, search and folder import moved off the
  overlay radius onto `md`.
- The knowledge sidebar's display-options dropdown moved onto `lg`; it is a
  floating surface and was the only one that was not.
- Focus: the outline idiom is gone. One `.kh-focus-ring` class composes the
  ring, and every interactive surface uses it.
- `--kh-danger` split into a text colour and a solid surface. A filled
  destructive button needs a mid red that holds white text; danger text on a
  dark background needs a light red. One token could not serve both once a
  dark theme existed.

## 7. Theme Contract

A dark theme is served by two selectors carrying identical values: a
`prefers-color-scheme` media query for visitors who never touch the control,
which also works with JavaScript disabled, and a `data-theme` attribute for an
explicit choice. Plain CSS cannot share a variable block across that boundary,
so the duplication is deliberate and the two must be edited together.

An explicit choice persists to `localStorage` under `kh:theme`. A pre-paint
script in the document head applies it before first paint.

## 8. Open items

Named in the audit that produced this amendment, deliberately not delivered
here because each changes behaviour rather than appearance:

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

## 9. Completion Criteria

- Off-scale type, radius, elevation and motion values do not compile.
- `lg` radius and both elevation tokens appear only on floating surfaces.
- No component declares a colour outside the token layer.
- One focus idiom across the codebase.
- Light and dark themes resolve every token.
