/** Han, kana and hangul: written without spaces, so each character is counted as a word, as word counters for them do. */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

/**
 * Words in Markdown, as the page shows them: what a reader reads, not the syntax around it. Link and image
 * addresses, HTML tags, fence markers and list numbers are not words; a `[[wikilink]]` counts its target.
 * Latin words and numbers count by run, CJK characters one each.
 */
export function countWords(markdown: string): number {
  const text = markdown
    .replace(/^[ \t]*(?:```|~~~)[^\n]*$/gm, " ")
    .replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, " ")
    .replace(/\]\([^)\n]*\)/g, "]")
    .replace(/\[\[([^\]|#\n]*)[^\]\n]*\]\]/g, "$1")
    .replace(/<[^>\n]+>/g, " ")
    .replace(/^[ \t]*\d{1,9}[.)][ \t]/gm, " ");
  const cjk = text.match(CJK)?.length ?? 0;
  const words = text.replace(CJK, " ").match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0;
  return cjk + words;
}
