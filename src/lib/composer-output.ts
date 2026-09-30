/** Content the composer compares: the `markdown` state plus its carried title. */
export type ComposerContent = { markdown: string; title: string };

/**
 * Composer spec §11.2 release rule: content identical to the initial content
 * is not a modification, so `touched` releases — wherever the content arrived
 * from. Rendered output releases it in `adopt`, but typing then reverting
 * inside the 200 ms output debounce emits no output at all (issue #65), and
 * source edits never pass through `adopt`: the flush (blur, mode switch,
 * save, unload) and the source path compare here instead. A match clears
 * without writing anything back, so an untouched document is never saved in
 * normalized form; a normalization-only difference keeps the document dirty.
 */
export function matchesInitial(content: ComposerContent, initial: ComposerContent): boolean {
  return content.markdown === initial.markdown && content.title === initial.title;
}
