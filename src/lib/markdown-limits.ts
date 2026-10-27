// Vercel caps a Function request body at 4.5 MB. A save is a JSON body, so
// 3.5 MiB of Markdown leaves room for JSON escaping and the surrounding fields.
export const MAX_MARKDOWN_BYTES = 3.5 * 1024 * 1024;
const encoder = new TextEncoder();

export function markdownBytes(markdown: string): number {
  return encoder.encode(markdown).byteLength;
}

export function markdownTooLarge(markdown: string): boolean {
  return markdownBytes(markdown) > MAX_MARKDOWN_BYTES;
}

export function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
