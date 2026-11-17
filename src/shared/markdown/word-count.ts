/** Han, kana and hangul: written without spaces, so each character is counted as a word, as word counters for them do. */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
/** A word: letters, numbers and the marks that combine with them (Hindi, Hebrew, decomposed accents), `'`, `_` and `-` inside it, and `3.14` or `1,000` as one number. */
const WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'’_-]*(?:[.,]\p{N}+)*/gu;

/**
 * Words in Markdown, as the page shows them: what a reader reads, not the syntax around it. Link and image addresses, bare
 * addresses, reference definitions, HTML tags, fence markers and list markers are not words; a `[[wikilink]]` counts its
 * target. Latin words and numbers count by run, CJK characters one each. Every scan is bounded by the line and by a length, so
 * a long line without a closer (pasted minified code, a log) cannot make it slow.
 */
export function countWords(markdown: string): number {
  const text = markdown
    .replace(/^[ \t]*(?:```|~~~)[^\n]*$/gm, " ")
    .replace(/^[ \t]*\[[^\]\n]{1,200}\]:[ \t]*\S+[^\n]{0,500}$/gm, " ")
    .replace(/!\[\[[^\]\n]{1,300}\]\]/g, " ")
    .replace(/!\[[^\]\n]{0,300}\]\([^)\n]{0,2000}\)/g, " ")
    .replace(/\]\([^)\n]{0,2000}\)/g, "]")
    .replace(/\[\[([^\]|#\n]{0,300})(?:[|#][^\]\n]{0,300})?\]\]/g, "$1")
    .replace(/<[^>\n]{1,300}>/g, " ")
    .replace(/https?:\/\/\S{1,2000}/g, " ")
    .replace(/^[ \t>]*(?:(?:\d{1,9}[.)]|[-*+])[ \t]+)+/gm, " ");
  const cjk = text.match(CJK)?.length ?? 0;
  const words = text.replace(CJK, " ").match(WORD)?.length ?? 0;
  return cjk + words;
}
