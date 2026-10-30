"use client";

import { Timestamp } from "@/components/ui/timestamp";
import type { Contribution, PublicationDocumentView } from "@/modules/sources/domain/publication";
import type { PublicationListItem } from "@/modules/sources/application/publication-service";

/**
 * What the team tree says about one publication and its documents.
 *
 * A publication is one top-level entry. Its creator is attribution, not an
 * update right; a document's maintainer is the one person whose originals
 * update it. "No longer updated" is reserved for a contribution that left or
 * lost its rights, and pending catch-up is a different, temporary state.
 */
export type PublicationContributionState = "ACTIVE" | "LEFT" | "FROZEN" | "PENDING";

export type PublicationDocumentMeta = {
  maintainerName: string;
  state: PublicationContributionState;
};

export type PublicationTreeMeta = {
  publicationId: string;
  sourceId: string;
  name: string;
  creatorName: string;
  updatedAt: Date | string;
  state: PublicationContributionState;
  documents: Record<string, PublicationDocumentMeta>;
};

export const PUBLICATION_COPY = {
  publish: "發佈到團隊",
  join: "加入",
  joinInstead: (name: string) => `改為加入「${name}」`,
  maintainedBy: (name: string) => `由 ${name} 維護`,
  noLongerUpdated: "不再更新",
  pending: "等待同步",
  updatedBy: "更新者",
  left: "離開",
  resume: "繼續更新",
  unpublish: "取消發佈／封存",
  restore: "還原",
  rename: "重新命名",
  keptOut: (name: string) => `由 ${name} 維護，你的版本不會更新團隊`,
  lowOverlap: "這個資料夾與這個發佈重疊很少，請確認是不是同一個資料夾。",
  lowOverlapAcknowledge: "我了解這個資料夾與團隊發佈的內容重疊很少",
} as const;

/** What a contributor's own state says about the copies they maintain. */
export function contributionState(
  own: Pick<Contribution, "leftAt" | "rightsFrozenAt" | "pendingCatchUp"> | null,
): PublicationContributionState {
  if (own === null) return "ACTIVE";
  if (own.leftAt !== null) return "LEFT";
  if (own.rightsFrozenAt !== null) return "FROZEN";
  if (own.pendingCatchUp) return "PENDING";
  return "ACTIVE";
}

/**
 * One team copy's state from the caller's point of view: only the copy's own
 * maintainer is affected by that contributor leaving or being frozen.
 */
export function documentPublicationState(
  document: Pick<PublicationDocumentView, "creatorUserId">,
  own: Pick<Contribution, "userId" | "leftAt" | "rightsFrozenAt" | "pendingCatchUp"> | null,
): PublicationContributionState {
  if (own === null || document.creatorUserId !== own.userId) return "ACTIVE";
  return contributionState(own);
}

export function publicationTreeMeta(item: PublicationListItem): PublicationTreeMeta {
  const state = contributionState(item.ownContribution);
  return {
    publicationId: item.publication.id,
    sourceId: item.publication.sourceId,
    name: item.publication.name,
    creatorName: item.creatorName,
    updatedAt: item.updatedAt,
    state,
    documents: Object.fromEntries(item.documents.map((document) => [
      document.teamDocumentId,
      {
        maintainerName: document.creatorName,
        state: documentPublicationState(document, item.ownContribution),
      } satisfies PublicationDocumentMeta,
    ])),
  };
}

function stateLabel(state: PublicationContributionState): string | null {
  if (state === "LEFT" || state === "FROZEN") return PUBLICATION_COPY.noLongerUpdated;
  if (state === "PENDING") return PUBLICATION_COPY.pending;
  return null;
}

/** A publication entry's creator and relative update time, with its own lifecycle note. */
export function PublicationEntryMeta({ meta }: { meta: PublicationTreeMeta }) {
  return (
    <span
      data-publication-meta={meta.publicationId}
      className="flex min-w-0 items-center gap-1 text-caption text-kh-text-muted"
    >
      <span data-publication-creator="">{meta.creatorName}</span>
      <span aria-hidden="true">·</span>
      <span className="whitespace-nowrap">
        <Timestamp value={meta.updatedAt} variant="short" /> 更新
      </span>
      {stateLabel(meta.state) ? (
        <>
          <span aria-hidden="true">·</span>
          <span data-publication-state={meta.state}>{stateLabel(meta.state)}</span>
        </>
      ) : null}
    </span>
  );
}

/**
 * A team document's maintainer. It names who updates the copy and, where the
 * contribution has stopped, says so; it never says "author".
 */
export function PublicationDocumentMetaLine({ meta }: { meta: PublicationDocumentMeta }) {
  const label = stateLabel(meta.state);
  return (
    <span data-publication-document-meta="" className="block truncate text-caption text-kh-text-muted">
      <span>{PUBLICATION_COPY.maintainedBy(meta.maintainerName)}</span>
      <span aria-hidden="true"> · </span>
      <span>{PUBLICATION_COPY.updatedBy} {meta.maintainerName}</span>
      {label ? <span data-publication-state={meta.state}> · {label}</span> : null}
    </span>
  );
}
