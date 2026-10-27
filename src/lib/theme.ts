/** The reader's choice; `system` follows the operating system. */
export type ThemeChoice = "light" | "dark" | "system";

/** What the document actually wears. */
export type ResolvedTheme = "light" | "dark";

/** Light until someone chooses otherwise, as the product has always started. */
export const DEFAULT_THEME_CHOICE: ThemeChoice = "light";

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * The theme a choice means right now. `system` is the only choice that reads
 * the operating system, and it reads it afresh on every call so a preference
 * changed while the page is open is not remembered as yesterday's answer.
 */
export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ResolvedTheme {
  if (choice === "light") return "light";
  if (choice === "dark") return "dark";
  return prefersDark ? "dark" : "light";
}
