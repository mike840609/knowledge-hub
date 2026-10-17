"use client";

import { MarkdownRenderer } from "../markdown-renderer";

/** Loaded only by an existing inline document, never by the new-note composer. */
export function InlineCodePreview({ code, language }: { code: string; language: string }) {
  let longest = 2;
  for (const match of code.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  const fence = "`".repeat(longest + 1);
  return <MarkdownRenderer markdown={`${fence}${language}\n${code}\n${fence}`} />;
}
