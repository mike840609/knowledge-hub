import { MAX_MARKDOWN_BYTES, formatBytes } from "@/lib/markdown-limits";

export function DraftSizeHint({ bytes }: { bytes: number }) {
  if (bytes < MAX_MARKDOWN_BYTES * 0.8) return null;
  const tooLarge = bytes > MAX_MARKDOWN_BYTES;
  return (
    <span className={tooLarge ? "text-kh-danger" : "text-kh-warning"}>
      {formatBytes(bytes)} of {formatBytes(MAX_MARKDOWN_BYTES)}{tooLarge ? " — too large to save" : ""}
    </span>
  );
}
