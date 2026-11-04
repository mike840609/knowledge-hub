"use client";

import { Button } from "@/components/ui/button";
import { SelectMenu } from "@/components/ui/select-menu";
import { tabClasses, tabListClasses } from "@/components/ui/tab";
import type { InboxKindFilter, InboxStatusFilter } from "@/modules/knowledge/domain/inbox-discussion";

const RELATIONSHIPS: readonly { value: InboxKindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "owner", label: "My documents" },
  { value: "follow", label: "Following" },
  { value: "mention", label: "Mentions" },
];

const STATUSES: readonly { value: InboxStatusFilter; label: string }[] = [
  { value: "all", label: "Any status" },
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
];

/**
 * The one discussion index, refined three ways: the reader's relationship to a
 * thread, its state, and whether it is unread. The tabs are a filter, not a
 * panel switcher — the list below them is the panel — so they are plain buttons
 * with `aria-selected`, styled by the shared tab shape.
 */
export function InboxFilters({
  kind,
  status,
  unread,
  onKindChange,
  onStatusChange,
  onUnreadChange,
  sticky = false,
}: {
  kind: InboxKindFilter;
  status: InboxStatusFilter;
  unread: boolean;
  onKindChange: (kind: InboxKindFilter) => void;
  onStatusChange: (status: InboxStatusFilter) => void;
  onUnreadChange: (unread: boolean) => void;
  sticky?: boolean;
}) {
  return <div className={`space-y-2 pb-3 ${sticky ? "sticky top-0 z-10 bg-kh-bg" : ""}`}>
    <div role="tablist" aria-label="Inbox relationships" className={tabListClasses}>
      {RELATIONSHIPS.map(relationship => <button
        key={relationship.value}
        type="button"
        role="tab"
        aria-selected={kind === relationship.value}
        className={tabClasses(kind === relationship.value)}
        onClick={() => onKindChange(relationship.value)}
      >{relationship.label}</button>)}
    </div>
    <div className="flex flex-wrap items-center gap-1">
      <SelectMenu
        id="inbox-status"
        aria-label="Status"
        value={status}
        onValueChange={value => onStatusChange(value)}
        options={STATUSES}
      />
      <Button variant={unread ? "soft" : "ghost"} aria-pressed={unread} onClick={() => onUnreadChange(!unread)}>
        Unread
      </Button>
    </div>
  </div>;
}
