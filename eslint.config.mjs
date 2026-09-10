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

const webAdapterRestrictions = [
  { "group": ["@/infrastructure/**", "../infrastructure/**", "../../infrastructure/**", "../../../infrastructure/**", "**/infrastructure/**"], "message": "Web adapters must call application services through the composition root." },
  { "group": ["mariadb", "mariadb/**"], "message": "Web adapters must call application services instead of the database driver." },
];

export default tseslint.config(
  {
    ignores: [".next/**", "node_modules/**", "playwright-report/**", "test-results/**", "next-env.d.ts"],
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
      }]
    }
  }
);
