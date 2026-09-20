import type { Config } from "tailwindcss";

/**
 * Design tokens. The scales below are *replaced*, not extended, so the only
 * spellings that compile are the ones named here — an arbitrary `text-[13px]`
 * or a stray `rounded-xl` fails loudly instead of quietly forking the system.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    // Six UI sizes plus two that exist only for rendered documents.
    fontSize: {
      micro: ["11px", { lineHeight: "14px" }],
      caption: ["12px", { lineHeight: "16px" }],
      "body-sm": ["13px", { lineHeight: "18px" }],
      body: ["14px", { lineHeight: "20px" }],
      title: ["16px", { lineHeight: "24px" }],
      heading: ["20px", { lineHeight: "28px" }],
      // Document scale: longer measure wants a larger size and looser leading.
      reading: ["15px", { lineHeight: "28px" }],
      display: ["24px", { lineHeight: "32px" }],
    },
    // Controls at 6px, overlays at 10px. `sm` is for inline chrome (kbd, code).
    borderRadius: {
      none: "0",
      sm: "4px",
      md: "6px",
      lg: "10px",
      full: "9999px",
    },
    // Two elevations, themed via variables so dark mode can deepen them.
    boxShadow: {
      none: "none",
      popover: "var(--kh-shadow-popover)",
      modal: "var(--kh-shadow-modal)",
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
    extend: {
      colors: {
        "kh-bg": "var(--kh-bg)",
        "kh-bg-raised": "var(--kh-bg-raised)",
        "kh-bg-sunken": "var(--kh-bg-sunken)",
        "kh-bg-subtle": "var(--kh-bg-subtle)",
        "kh-bg-hover": "var(--kh-bg-hover)",
        "kh-bg-selected": "var(--kh-bg-selected)",
        "kh-border": "var(--kh-border)",
        "kh-text": "var(--kh-text)",
        "kh-text-muted": "var(--kh-text-muted)",
        "kh-primary": "var(--kh-primary)",
        "kh-primary-hover": "var(--kh-primary-hover)",
        "kh-on-primary": "var(--kh-on-primary)",
        "kh-link": "var(--kh-link)",
        "kh-focus": "var(--kh-focus)",
        "kh-selected-text": "var(--kh-selected-text)",
        "kh-highlight": "var(--kh-highlight)",
        "kh-overlay": "var(--kh-overlay)",
        "kh-danger": "var(--kh-danger)",
        "kh-danger-hover": "var(--kh-danger-hover)",
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
