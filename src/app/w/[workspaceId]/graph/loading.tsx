import { Skeleton } from "@/components/ui/skeleton";

export default function GraphLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col px-6 py-4">
      <p role="status" className="sr-only">Loading graph</p>
      <div aria-hidden="true" className="flex h-full flex-col gap-3">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="min-h-[24rem] flex-1" />
      </div>
    </div>
  );
}
