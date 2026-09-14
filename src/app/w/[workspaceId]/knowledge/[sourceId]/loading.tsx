import { Skeleton } from "@/components/ui/skeleton";

export default function SourceDocumentLoading() {
  return (
    <div className="mx-auto w-full max-w-[860px] px-6 py-6" aria-label="Loading document">
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
  );
}
