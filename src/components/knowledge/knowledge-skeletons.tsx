import { Skeleton } from "@/components/ui/skeleton";

/**
 * One loading idiom: a skeleton shaped like the thing being fetched, plus a
 * screen-reader-only status line, because a skeleton is `aria-hidden` and on
 * its own says nothing. The three spellings this replaces — a skeleton here, a
 * `Loading documents…` paragraph there, a `Searching…` one elsewhere — meant
 * the same wait looked different depending on which region was slow.
 *
 * The document skeleton lives here rather than beside either of its two
 * callers because it has two: the route's `loading.tsx` and the layout's
 * `Suspense` fallback. Copied into both, they had drifted to different
 * paddings, so the page shifted as one handed over to the other.
 */
function LoadingStatus({ children }: { children: string }) {
  return <p role="status" className="sr-only">{children}</p>;
}

export function DocumentSkeleton() {
  return (
    <div className="kh-reading-column pb-6 pt-5">
      <LoadingStatus>Loading document</LoadingStatus>
      <div aria-hidden="true">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-3 h-7 w-2/3" />
        <div className="mt-3 flex gap-2">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-44" />
        </div>
        <div className="mt-6 space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    </div>
  );
}

const TREE_ROW_WIDTHS = ["w-4/5", "w-3/5", "w-2/3", "w-1/2", "w-3/4", "w-2/5"];

export function TreeSkeleton() {
  return (
    <div className="space-y-2">
      <LoadingStatus>Loading documents</LoadingStatus>
      <div aria-hidden="true" className="space-y-2">
        {TREE_ROW_WIDTHS.map((width, index) => (
          <Skeleton key={index} className={`h-6 ${width}`} />
        ))}
      </div>
    </div>
  );
}

const RESULT_ROW_WIDTHS = ["w-3/4", "w-2/3", "w-4/5", "w-1/2"];

/** Two-line rows, matching the shape of a quick-search hit. */
export function ResultListSkeleton() {
  return (
    <div className="space-y-2 px-3 py-2">
      <LoadingStatus>Searching</LoadingStatus>
      <div aria-hidden="true" className="space-y-3">
        {RESULT_ROW_WIDTHS.map((width, index) => (
          <div key={index} className="space-y-1.5">
            <Skeleton className={`h-4 ${width}`} />
            <Skeleton className="h-3 w-1/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
