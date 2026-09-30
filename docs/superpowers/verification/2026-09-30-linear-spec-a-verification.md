# Linear Spec A — verification record (2026-09-30)

Tasks 1–4 landed on `claude/linear-spec-a` (`cd682b8`, `aa8f9d3`, `98dbf4c`,
`1efbc1c`); this task amends the living contract to match and runs the total
gate. Screenshots below are eyewitness notes from a real dev server against the
seeded MariaDB, not fixtures asserted in code.

## 1. Contract amendments (`frontend-design-language.md`, same PR)

- §4: `Weight` row — `normal` 400, `medium` 510, `semibold` 590, the only three
  weights; `Family` row — `sans` (Inter variable), `mono` (Geist Mono
  variable), with the job each does.
- §6: `secondary` leaves the `border-strong` list — it sits on `--kh-ghost`,
  so the fill already separates it and its border is decorative `border`.
  `--kh-ghost` / `--kh-ghost-hover` recorded with all four alphas.
- §7: dark ramp final values (`bg` #08090a, `raised` #0f1011, `sunken` #0b0c0e,
  `subtle` #191a1b); `sunken` marked as the interpolated step. The
  "Divergence" section is rewritten as "Convergence": the ramp is achromatic
  like the reference's, and the dark canvas sits at L\* 2.4 — the reference's
  own measured value, against the old 6.3.
- §9: body sets `cv01` + `ss03` globally (single-storey `a`, geometric `g`);
  `font-bold` and anything heavier compiles to nothing, and the one `font-bold`
  the codebase carried now reads `font-semibold`.

## 2. Total gate

`make verify` — PASS: unit **97 files / 1424 tests**, typecheck clean, lint
clean, production build clean (route list renders, no errors).

Weight/colour convergence grep — empty, as required:

```bash
rg -n "font-(bold|extrabold|black)|font-\[5|font-\[6|#ffffff.*text|bg-transparent.*ghost" src --no-heading
# no output (exit 1)
```

## 3. Real-DB screenshots (light/dark × document / tree / ⌘K / sources)

Method: `make db-up`, `make db-migrate db-seed` (idempotent, already current),
`npm run dev` on 127.0.0.1:3000, theme pinned via `localStorage kh:theme`
before first paint, captures with the repo's Playwright Chromium against the
seeded My Space workspace. Shots held out of the repo (under `/tmp`); what
they showed:

- **No pure-white body text.** Computed `--kh-text` #1d1f24 (light) /
  #e7e8ec (dark); both themes read as tinted paper, not #fff on #000.
- **No solid dark borders.** Computed `--kh-border` rgba(255,255,255,0.08),
  `--kh-border-strong` rgba(255,255,255,0.34); dividers, the `On this page`
  box, palette frame and source badges all render as soft translucent lines.
- **No 700 weight.** Computed `font-medium` → 510, `font-semibold` → 590 in
  both themes; titles read semibold without ever going black.
- **`a` single-storey, `g` geometric.** 2× zoom of "Updated 22 hours ago"
  shows ɑ-form `a` and single-circle `g`; computed `font-feature-settings`
  `"cv01", "ss03"` on `body` in both themes.
- **Button hover is a fill change.** Sources → Import folder (secondary):
  rest rgba(255,255,255,0.02) → hover rgba(255,255,255,0.05) → rest 0.02.
  Press ships as `active:scale-[0.98]` with `transition-[background-color,
  transform]` on the base string (unit-held in `ui-primitives.test.tsx`).
- Palette (both themes): selected row in tint, group labels muted, no weight
  or border regressions; tree + reader share the organize layout in this
  workspace, so the tree shot is that layout's sidebar half.

## 4. Final numbers (for the record)

- `border-strong` dark: alpha **0.34**, three +0.02 steps from 0.28; ratios
  **bg 3.017 / subtle 3.121 / sunken 3.058** (all ≥ 3:1, WCAG 1.4.11).
- Ghost: light **0.03 / 0.06**, dark **0.02 / 0.05** (rest / hover).
- Weights: **400 / 510 / 590**; 700 does not exist in the scale.
- Dark canvas L\* **2.4** (was 6.3; reference measures 2.4).
