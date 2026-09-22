import type { Config } from "tailwindcss";

/**
 * Design tokens. The scales below are *replaced*, not extended, so the only
 * spellings that compile are the ones named here — an arbitrary `text-[13px]`
 * or a stray `rounded-xl` fails loudly instead of quietly forking the system.
 *
 * Contract and rationale: docs/superpowers/specs/frontend-design-language.md
 */
const rhythm = {
  0: "0px",
  px: "1px",
  0.5: "0.125rem",
  1: "0.25rem",
  1.5: "0.375rem",
  2: "0.5rem",
  2.5: "0.625rem",
  3: "0.75rem",
  4: "1rem",
  5: "1.25rem",
  6: "1.5rem",
};

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    // Six UI sizes plus two that exist only for rendered documents.
    // Every size carries its own tracking. Reference values, measured from
    // linear.app: 12px 0, 13px -.01em, 14px -.013em, 15px -.011em, 17px 0.
    // Sizes without a measured counterpart are interpolated, not invented
    // from nothing, and are marked below.
    fontSize: {
      micro: ["11px", { lineHeight: "14px", letterSpacing: "-0.01em" }], // interpolated
      caption: ["12px", { lineHeight: "16px", letterSpacing: "0" }],
      "body-sm": ["13px", { lineHeight: "18px", letterSpacing: "-0.01em" }],
      body: ["14px", { lineHeight: "20px", letterSpacing: "-0.013em" }],
      title: ["16px", { lineHeight: "24px", letterSpacing: "-0.01em" }], // interpolated
      heading: ["20px", { lineHeight: "28px", letterSpacing: "-0.015em" }], // interpolated
      // Document scale: longer measure wants a larger size and looser leading
      // than the reference, which sets 15px at 1.6 for marketing prose.
      reading: ["15px", { lineHeight: "28px", letterSpacing: "-0.011em" }],
      display: ["24px", { lineHeight: "32px", letterSpacing: "-0.015em" }], // interpolated
    },
    // Rungs of the reference ladder (4/6/8/12/16/24/32), taking the four this
    // product needs: inline chrome, controls, menus, modals. 10px, used
    // earlier, is not on that ladder at all.
    borderRadius: {
      none: "0",
      sm: "4px",
      md: "6px",
      lg: "8px",
      xl: "12px",
      full: "9999px",
    },
    // Two elevations, themed via variables so dark mode can deepen them.
    boxShadow: {
      none: "none",
      popover: "var(--kh-shadow-popover)",
      modal: "var(--kh-shadow-modal)",
    },
    // Page containers, named by the job rather than by a size on Tailwind's
    // ladder. Five widths were in use for what were mostly the same kind of
    // page; these are the three that turned out to have distinct jobs, plus
    // the panel width used inside a page. Replacing the scale means
    // `max-w-4xl` no longer compiles, so a sixth cannot appear quietly.
    // Arbitrary values still work, for the one-off truncation widths that are
    // not containers at all.
    maxWidth: {
      none: "none",
      full: "100%",
      panel: "36rem", // a form panel sitting inside a page
      reading: "860px", // prose measure — see §7
      page: "56rem", // the standard page container
      wide: "64rem", // a page whose content is a table
    },
    transitionDuration: {
      DEFAULT: "120ms",
      0: "0ms",
      120: "120ms",
      160: "160ms",
    },
    transitionTimingFunction: {
      DEFAULT: "cubic-bezier(0.16, 1, 0.3, 1)",
      out: "cubic-bezier(0.16, 1, 0.3, 1)",
      linear: "linear",
    },
    // Spacing rhythm: the 2px-base ladder the codebase actually uses, 0–24px
    // in every 2px step (0.5–6), plus the zero/1px/auto utilities and the one
    // tall vertical rhythm below. Census of src/ (p/m/gap/space), 2026-09-22:
    // 8px ~123, 12px ~103, 4px ~43, 24px ~38, 16px ~35, 2px ~21, 6px ~13,
    // 20px ~10, 10px ~7, 0/auto a handful each. Nothing else is used, so
    // nothing else compiles: p-7/m-8/gap-9 and the rest of Tailwind's default
    // produce no CSS, the same bar as text-[13px] and rounded-xl.
    // Deliberately NOT `spacing`: width/height (h-6/h-8/h-10 control ladder,
    // w-72 sidebars, icon h-4/w-4) and inset/translate read from `spacing`,
    // and a sidebar width is not a decision about rhythm (§18 item 2).
    padding: {
      ...rhythm,
      16: "4rem", // StatusMessage's centred-message vertical rhythm — see §7
    },
    margin: {
      ...rhythm,
      auto: "auto", // mx-auto/ml-auto centring; negatives (-mx-6, -mb-px) derive
    },
    gap: { ...rhythm }, // gap-x-*/gap-y-* read this scale too
    space: { ...rhythm },
    extend: {
      colors: {
        "kh-bg": "var(--kh-bg)",
        "kh-bg-raised": "var(--kh-bg-raised)",
        "kh-bg-sunken": "var(--kh-bg-sunken)",
        "kh-bg-subtle": "var(--kh-bg-subtle)",
        "kh-bg-hover": "var(--kh-bg-hover)",
        "kh-bg-selected": "var(--kh-bg-selected)",
        "kh-border": "var(--kh-border)",
        "kh-border-strong": "var(--kh-border-strong)",
        "kh-text": "var(--kh-text)",
        "kh-text-secondary": "var(--kh-text-secondary)",
        "kh-text-muted": "var(--kh-text-muted)",
        "kh-text-faint": "var(--kh-text-faint)",
        "kh-primary": "var(--kh-primary)",
        "kh-primary-hover": "var(--kh-primary-hover)",
        "kh-on-primary": "var(--kh-on-primary)",
        "kh-link": "var(--kh-link)",
        "kh-focus": "var(--kh-focus)",
        "kh-selected-text": "var(--kh-selected-text)",
        "kh-highlight": "var(--kh-highlight)",
        "kh-overlay": "var(--kh-overlay)",
        "kh-danger": "var(--kh-danger)",
        "kh-danger-solid": "var(--kh-danger-solid)",
        "kh-danger-solid-hover": "var(--kh-danger-solid-hover)",
        "kh-danger-bg": "var(--kh-danger-bg)",
        "kh-danger-border": "var(--kh-danger-border)",
        "kh-warning": "var(--kh-warning)",
        "kh-warning-bg": "var(--kh-warning-bg)",
        "kh-warning-border": "var(--kh-warning-border)",
        "kh-success": "var(--kh-success)",
        "kh-success-bg": "var(--kh-success-bg)",
        "kh-success-border": "var(--kh-success-border)",
      },
    },
  },
  plugins: [],
};

export default config;
