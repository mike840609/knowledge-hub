/**
 * Heading anchors, compatible with GitHub's so that a document written
 * elsewhere keeps working: `[see setup](#local-setup)` in an imported
 * Obsidian or LLM-wiki folder has to land on the heading it names without the
 * author changing anything.
 *
 * Lower-case, drop everything that is not a letter, mark, number, connector
 * (`_`), hyphen or space, then turn each space into a hyphen. Runs of hyphens
 * are kept and so are leading and trailing ones — `a - b` is `a---b` on GitHub,
 * and matching it exactly is the point. Non-Latin headings survive
 * (`請假流程` → `請假流程`). A heading with nothing left becomes `section`
 * rather than an empty id, which cannot be linked to.
 */
export function headingSlug(text: string): string {
  const slug = text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
    .replace(/ /g, "-");
  return slug === "" ? "section" : slug;
}

/**
 * Hands out slugs for one document, in reading order. A repeat gets `-1`,
 * `-2`, … appended, and — as on GitHub — a suffixed slug is itself taken, so a
 * heading literally called "Setup 1" after two "Setup"s does not collide with
 * the second one's `setup-1`.
 */
export class HeadingSlugger {
  private readonly occurrences = new Map<string, number>();

  slug(text: string): string {
    const base = headingSlug(text);
    let slug = base;
    while (this.occurrences.has(slug)) {
      const next = (this.occurrences.get(base) ?? 0) + 1;
      this.occurrences.set(base, next);
      slug = `${base}-${next}`;
    }
    this.occurrences.set(slug, 0);
    return slug;
  }
}
