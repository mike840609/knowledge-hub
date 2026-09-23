/**
 * Whether a document opens with its own `#` heading. When it does, that
 * heading is the page's title: a header title above it would be a second one,
 * smaller than the first. The saved title stays visible as the breadcrumb's
 * last segment, so the document's identity is never hidden.
 */
export function markdownOpensWithHeading(markdown: string): boolean {
  return /^﻿?(?:[ \t]*\r?\n)*#[ \t]+\S/.test(markdown);
}
