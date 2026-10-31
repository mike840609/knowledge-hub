"use client";

import type { PublicationNotice } from "@/modules/sources/domain/publication";
import { PUBLICATION_COPY } from "./publication-entry-meta";

/**
 * What a contributor's Folder Sync preview and result say about the team.
 *
 * These are display-only facts from `publicationNotices`: who maintains a
 * path, why a move stayed on the team side, and which publication already
 * holds an original. They never carry a comment body, a personal origin or a
 * publication name the caller cannot read.
 */
export function MaintainedByNotice({
  notice,
  names,
}: {
  notice: PublicationNotice;
  names: Readonly<Record<string, string>>;
}) {
  if (notice.code === "MAINTAINED_BY_OTHER") {
    const maintainer = notice.maintainerName
      ?? (notice.maintainerUserId ? names[notice.maintainerUserId] : undefined)
      ?? "其他成員";
    return (
      <p data-publication-notice={notice.code} className="text-body text-kh-text-muted">
        {PUBLICATION_COPY.keptOut(maintainer)}
        {notice.sourcePath ? <span className="text-caption"> · {notice.sourcePath}</span> : null}
      </p>
    );
  }
  if (notice.code === "PATH_RESERVED") {
    return (
      <p data-publication-notice={notice.code} className="text-body text-kh-warning">
        團隊文件的路徑{notice.sourcePath ? `「${notice.sourcePath}」` : ""}保留給其他文件，這次移動不會更新團隊。
      </p>
    );
  }
  return (
    <p data-publication-notice={notice.code} className="text-body text-kh-warning">
      這份原稿已在「{notice.existingPublicationName ?? "其他發佈"}」發佈，團隊不會出現第二份。
    </p>
  );
}

export function PublicationSyncNotices({
  notices,
  names,
}: {
  notices: readonly PublicationNotice[] | undefined;
  names: Readonly<Record<string, string>>;
}) {
  if (!notices || notices.length === 0) return null;
  return (
    <section aria-label="團隊發佈" className="space-y-1">
      {notices.map((notice, index) => (
        <MaintainedByNotice
          key={`${notice.publicationId}:${notice.code}:${notice.originalDocumentId ?? notice.sourcePath ?? index}`}
          notice={notice}
          names={names}
        />
      ))}
    </section>
  );
}

/**
 * After a sync completes, the caller's own contribution status is read again:
 * a blocked path may be clear now, or a catch-up may still be pending. The
 * read is the same status route the team page uses; a failure is ignored
 * because the result page already succeeded.
 */
export async function refreshPublicationStatuses(
  publicationIds: readonly string[],
): Promise<Array<{ publicationId: string; pending: boolean }>> {
  const results: Array<{ publicationId: string; pending: boolean }> = [];
  for (const publicationId of [...new Set(publicationIds)]) {
    try {
      const response = await fetch(`/api/publications/${publicationId}/status`, { cache: "no-store" });
      if (!response.ok) continue;
      const body = await response.json() as { pending?: unknown };
      results.push({ publicationId, pending: body.pending === true });
    } catch {
      // A status read is a courtesy after a successful sync; never fail it.
    }
  }
  return results;
}
