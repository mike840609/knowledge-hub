import { highlightSnippet } from "@/modules/knowledge/domain/search-query";

export function HighlightedSearchText({ text, terms }: { text: string; terms: readonly string[] }) {
  return (
    <>
      {highlightSnippet(text, terms).map((segment, index) =>
        segment.match
          ? <mark key={index} className="rounded-sm bg-kh-highlight font-medium text-kh-text underline decoration-kh-primary decoration-2 underline-offset-2">{segment.text}</mark>
          : <span key={index}>{segment.text}</span>,
      )}
    </>
  );
}

