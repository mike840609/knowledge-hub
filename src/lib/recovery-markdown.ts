import { resolveAuthoredTitle } from "./authored-title";
import { addRecoveredTitle } from "./recovered-title";

/** Preserve the current title source, metadata and body for a recovery upload. */
export async function buildRecoveryMarkdown(input: { title: string; markdown: string; metadata: Record<string, unknown> }): Promise<{ title: string; markdown: string; recovery: boolean }> {
  const metadata = { ...input.metadata };
  const hasMetadataTitle = typeof metadata.title === "string" && !!metadata.title.trim();
  const title = hasMetadataTitle ? input.title.trim() : resolveAuthoredTitle({ metadataTitle: metadata.title, markdown: input.markdown, typedTitle: input.title }).title;
  if (hasMetadataTitle) metadata.title = title;
  let markdown = title ? addRecoveredTitle(input.markdown, title) : input.markdown;
  if (Object.keys(metadata).length) {
    const { stringify } = await import("yaml");
    markdown = `---\n${stringify(metadata)}---\n${markdown}`;
  }
  return { title, markdown, recovery: !!title };
}
