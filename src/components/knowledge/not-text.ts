/**
 * What the reader renders that is not the document's visible text: screen-reader-only labels, hidden
 * decorations, images, footnote markers and HTML comments. Its own module so the ⌘K preview can use it
 * without importing the review-selection code.
 */
export const NOT_TEXT = '.sr-only,[aria-hidden="true"],[role="img"],[data-footnote-ref],sup[data-type="footnote_reference"],span[data-type="html"][data-value^="<!--"][data-value$="-->"]';
