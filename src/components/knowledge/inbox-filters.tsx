"use client";

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
 * thread, its state, and whether it is unread. These are filters rather than
 * ARIA tabs, so each button exposes a pressed state and keeps native keyboard
 * navigation. The shared tab shape still matches other pages.
 */
export function InboxFilters({
  kind,
  status,
  unread,
  onKindChange,
  onStatusChange,
  onUnreadChange,
  sticky = false,
  showRefinements = true,
}: {
  kind: InboxKindFilter;
  status: InboxStatusFilter;
  unread: boolean;
  onKindChange: (kind: InboxKindFilter) => void;
  onStatusChange: (status: InboxStatusFilter) => void;
  onUnreadChange: (unread: boolean) => void;
  sticky?: boolean;
  /** The relationship row is navigation; the status and unread refinements are not worth showing over an empty list. */
  showRefinements?: boolean;
}) {
  return <div className={`space-y-2 pb-3 ${sticky ? "sticky top-0 z-10 bg-kh-bg" : ""}`}>
    <div role="group" aria-label="Inbox relationships" className={tabListClasses}>
      {RELATIONSHIPS.map(relationship => <button
        key={relationship.value}
        type="button"
        aria-pressed={kind === relationship.value}
        className={tabClasses(kind === relationship.value)}
        onClick={() => onKindChange(relationship.value)}
      >{relationship.label}</button>)}
    </div>
    {showRefinements ? <div className="flex flex-wrap items-center gap-1">
      <SelectMenu
        id="inbox-status"
        aria-label="Status"
        className="w-32"
        value={status}
        onValueChange={value => onStatusChange(value)}
        options={STATUSES}
      />
      <label className="flex h-8 items-center gap-2 rounded-md px-1 text-body-sm text-kh-text-secondary">
        <input type="checkbox" checked={unread} onChange={() => onUnreadChange(!unread)} />
        Unread only
      </label>
    </div> : null}
  </div>;
}
