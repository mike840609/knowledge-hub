/**
 * Source mode is the page's code surface, not the page with its formatting
 * stripped. It takes the code block's monospace and inset fill so the reader
 * can tell at a glance that this is Markdown being edited, and the whole of it
 * is held in one field rather than floating on the canvas.
 *
 * One spelling, shared by the inline editor and the composer, so the two
 * source modes cannot drift apart (`2026-11-18-editor-source-and-title-design.md`).
 * No display utility belongs here: the composer toggles its field with the
 * `hidden` attribute, and a `block` class would override it.
 */
export const MARKDOWN_SOURCE_FIELD =
  "min-h-[12rem] w-full resize-none overflow-hidden rounded-md border border-kh-border-strong bg-kh-bg-subtle px-4 py-3 font-mono text-body-sm leading-6 text-kh-text outline-none placeholder:text-kh-text-muted";
