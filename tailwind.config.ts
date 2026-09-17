import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#102a43",
        paper: "#f7f9fb",
        accent: "#0f766e",
        "kh-bg": "var(--kh-bg)",
        "kh-bg-subtle": "var(--kh-bg-subtle)",
        "kh-bg-hover": "var(--kh-bg-hover)",
        "kh-bg-selected": "var(--kh-bg-selected)",
        "kh-border": "var(--kh-border)",
        "kh-text": "var(--kh-text)",
        "kh-text-muted": "var(--kh-text-muted)",
        "kh-primary": "var(--kh-primary)",
        "kh-primary-hover": "var(--kh-primary-hover)",
        "kh-link": "var(--kh-link)",
        "kh-focus": "var(--kh-focus)",
        "kh-highlight": "var(--kh-highlight)",
        "kh-danger": "var(--kh-danger)",
        "kh-warning": "var(--kh-warning)",
        "kh-success": "var(--kh-success)",
      },
    },
  },
  plugins: [],
};

export default config;
