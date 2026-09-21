import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";

const moduleBoundaryRestrictions = [
  { "group": ["next", "next/*", "react", "react/*"], "message": "Domain and application modules must not depend on web UI." },
  { "group": ["mariadb", "mariadb/**"], "message": "Domain and application modules must not depend on the database driver." },
  { "group": ["@/infrastructure/**", "../infrastructure/**", "../../infrastructure/**", "../../../infrastructure/**", "**/infrastructure/**"], "message": "Domain and application modules must depend on ports, not infrastructure." },
];

const knowledgeBoundaryRestrictions = [
  ...moduleBoundaryRestrictions,
  { "group": ["@/modules/sources/**", "../sources/**", "../../sources/**"], "message": "Knowledge must use its source-policy port; it must not depend on Sources implementation." },
];

/**
 * §10 of the design contract says there is one focus idiom, `.kh-focus-ring`,
 * and no second spelling. Unlike the type, radius, elevation and container
 * scales — which `tailwind.config.ts` replaces, so an off-scale value simply
 * does not compile — that rule had nothing enforcing it, and it was the one
 * rule the codebase broke: 29 hand-written copies across 17 files.
 *
 * The ring belongs in one place because it is themed and because a copy that
 * forgets `outline-none` draws the browser's own outline underneath it. Ten
 * of the 29 did.
 */
const focusRingRestriction = {
  selector: "Literal[value=/focus-visible:ring-(2|kh-focus)/]",
  message: "Use the `kh-focus-ring` class rather than spelling the ring out (design contract §10).",
};

const webAdapterRestrictions = [
  { "group": ["@/infrastructure/**", "../infrastructure/**", "../../infrastructure/**", "../../../infrastructure/**", "**/infrastructure/**"], "message": "Web adapters must call application services through the composition root." },
  { "group": ["mariadb", "mariadb/**"], "message": "Web adapters must call application services instead of the database driver." },
];

export default tseslint.config(
  {
    ignores: [".next/**", ".next-dev/**", "node_modules/**", "playwright-report/**", "test-results/**", "next-env.d.ts"],
  },
  ...tseslint.configs.recommended,
  {
    plugins: { "@next/next": nextPlugin },
    rules: nextPlugin.configs.recommended.rules,
  },
  {
    files: ["src/modules/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        "patterns": moduleBoundaryRestrictions,
      }]
    }
  },
  {
    files: ["src/modules/knowledge/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        "patterns": knowledgeBoundaryRestrictions,
      }]
    }
  },
  {
    files: ["src/components/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        "patterns": webAdapterRestrictions,
      }],
      "no-restricted-syntax": ["error", focusRingRestriction],
    }
  }
);
