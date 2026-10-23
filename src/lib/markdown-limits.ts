export const MAX_MARKDOWN_BYTES = 5 * 1024 * 1024;
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
