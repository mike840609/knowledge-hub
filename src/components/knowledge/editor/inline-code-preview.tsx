"use client";

import { Select } from "@/components/ui/select";
import { HIGHLIGHT_LANGUAGES } from "../code-highlight";
import { MarkdownRenderer } from "../markdown-renderer";

/** Loaded only by an existing inline document, never by the new-note composer. */
export function InlineCodePreview({ code, language }: { code: string; language: string }) {
  let longest = 2;
  for (const match of code.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  const fence = "`".repeat(longest + 1);
  return <MarkdownRenderer markdown={`${fence}${language}\n${code}\n${fence}`} />;
}

/** Plain text first, then what the reader's highlighter registers (code-highlight.ts); a fence naming anything else keeps its own entry, so opening the field never loses it. */
const LANGUAGE_NAMES = Object.keys(HIGHLIGHT_LANGUAGES).sort();
export function CodeLanguageField({ language, onChange }: { language: string; onChange: (language: string) => void }) {
  const known = language === "" || LANGUAGE_NAMES.includes(language);
  return (
    <label className="mr-2 inline-flex items-center gap-1 text-caption text-kh-text-muted">
      Language
      <Select size="sm" value={language} onChange={event => onChange(event.target.value)} className="text-caption">
        <option value="">Plain text</option>
        {!known && <option value={language}>{language}</option>}
        {LANGUAGE_NAMES.map(name => <option key={name} value={name}>{name}</option>)}
      </Select>
    </label>
  );
}
