import type { SourceListItemModel } from "@/server/source-read";
import { SourceListRow } from "@/components/sources/source-list-row";

export function SourceList({ workspaceId, items }: { workspaceId: string; items: SourceListItemModel[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-kh-border p-6 text-sm text-kh-text-muted">
        No sources in this workspace yet.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <SourceListRow key={item.source.id} workspaceId={workspaceId} item={item} />
      ))}
    </ul>
  );
}
