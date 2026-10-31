import { describe, expect, it } from "vitest";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { collectPublicationNotices, type ProposedOriginal } from "@/modules/sources/application/publication-notices";
import type {
  Contribution,
  DocumentBinding,
  Publication,
  PublicationDocument,
} from "@/modules/sources/domain/publication";
import type { SourceRepositories } from "@/modules/sources/ports/unit-of-work";

const caller: CallerContext = callerFromIdentity({
  id: "u1",
  emp_id: "PUB-U1",
  name: "Ann",
  org_code: "HRSD",
});

const publication: Publication = {
  id: "p1",
  sourceId: "s1",
  teamWorkspaceId: "t1",
  name: "HCM KM",
  kind: "FOLDER",
  creatorUserId: "u1",
  status: "ACTIVE",
};

function contribution(id: string, userId: string, role: "owner" | "joiner"): Contribution {
  return {
    id,
    publicationId: publication.id,
    userId,
    origin: role === "owner"
      ? { kind: "FOLDER", folderNodeId: "f-root" }
      : { kind: "FOLDER", folderNodeId: "f-ann" },
    leftAt: null,
    rightsFrozenAt: null,
    pendingCatchUp: false,
  };
}

const own = contribution("c1", "u1", "owner");
const other = contribution("c2", "u2", "joiner");

function teamDocument(input: {
  teamDocumentId: string;
  creatorContributionId: string;
  originalDocumentId: string;
  sourcePath: string;
}): PublicationDocument {
  return {
    teamDocumentId: input.teamDocumentId,
    publicationId: publication.id,
    creatorContributionId: input.creatorContributionId,
    currentOriginalDocumentId: input.originalDocumentId,
    sourcePath: input.sourcePath,
    status: "ACTIVE",
  };
}

/**
 * Records every `.find` a production loop performs on the documents array. The
 * notice pass must index once per publication, not scan the whole publication
 * per proposed original.
 */
function watchedDocuments(documents: PublicationDocument[]): {
  documents: PublicationDocument[];
  findCalls: () => number;
} {
  let findCalls = 0;
  const proxy = new Proxy(documents, {
    get(target, property, receiver) {
      if (property === "find") {
        return (...args: Parameters<typeof Array.prototype.find>) => {
          findCalls += 1;
          return target.find(...args);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return { documents: proxy, findCalls: () => findCalls };
}

function repositoriesWith(input: {
  documents: PublicationDocument[];
  bindings: DocumentBinding[];
}): SourceRepositories {
  return {
    publications: {
      listByContributor: async () => [own],
      findById: async () => publication,
      listDocuments: async () => input.documents,
      listContributions: async () => [own, other],
      listBindings: async () => input.bindings,
    },
    workspaces: {
      findById: async () => ({
        id: publication.teamWorkspaceId,
        name: "Direct Team",
        workspaceType: "TEAM",
        lifecycleState: "ACTIVE",
        personalOwnerUserId: null,
      }),
    },
    workspaceMemberships: {
      find: async () => ({ role: "EDITOR" }),
    },
    tree: {
      findById: async () => ({
        id: "f-root",
        sourceId: "personal-1",
        parentId: null,
        nodeType: "FOLDER",
        name: "docs",
        documentId: null,
        position: 0,
        status: "ACTIVE",
        updatedBy: "u1",
        archivedBy: null,
        archivedAt: null,
      }),
    },
    entries: {
      findByTreeNodeId: async () => ({ sourcePath: "root" }),
    },
    users: {
      findByIds: async () => [
        { id: "u1", name: "Ann" },
        { id: "u2", name: "Mike" },
      ],
    },
  } as unknown as SourceRepositories;
}

describe("publication notices", () => {
  it("indexes one publication's documents once instead of scanning per original", async () => {
    const documents: PublicationDocument[] = [];
    const bindings: DocumentBinding[] = [];
    const originals: ProposedOriginal[] = [];
    for (let index = 0; index < 400; index += 1) {
      const documentId = `d${index}`;
      const teamDocumentId = `td${index}`;
      const sourcePath = `docs/${index}.md`;
      documents.push(teamDocument({
        teamDocumentId,
        creatorContributionId: own.id,
        originalDocumentId: documentId,
        sourcePath,
      }));
      bindings.push({ contributionId: own.id, originalDocumentId: documentId, teamDocumentId });
      originals.push({ documentId, sourcePath: `root/${sourcePath}`, active: true });
    }
    const watched = watchedDocuments(documents);
    const notices = await collectPublicationNotices(
      repositoriesWith({ documents: watched.documents, bindings }),
      caller,
      { sourceId: "personal-1", originals, includePathReserved: true },
    );

    expect(notices).toEqual([]);
    // 400 originals × 400 documents was the old linear scan per original.
    expect(watched.findCalls()).toBe(0);
  });

  it("keeps the maintainer, path and reserved-path semantics with the indexes", async () => {
    const documents: PublicationDocument[] = [
      teamDocument({
        teamDocumentId: "td-bound",
        creatorContributionId: other.id,
        originalDocumentId: "d-bound",
        sourcePath: "docs/bound.md",
      }),
      teamDocument({
        teamDocumentId: "td-path",
        creatorContributionId: other.id,
        originalDocumentId: "d-path-other",
        sourcePath: "docs/path.md",
      }),
      teamDocument({
        teamDocumentId: "td-mine",
        creatorContributionId: own.id,
        originalDocumentId: "d-mine",
        sourcePath: "docs/mine.md",
      }),
      teamDocument({
        teamDocumentId: "td-holder",
        creatorContributionId: other.id,
        originalDocumentId: "d-holder",
        sourcePath: "docs/holder.md",
      }),
    ];
    const bindings: DocumentBinding[] = [
      { contributionId: own.id, originalDocumentId: "d-bound", teamDocumentId: "td-bound" },
      { contributionId: own.id, originalDocumentId: "d-mine", teamDocumentId: "td-mine" },
      { contributionId: own.id, originalDocumentId: "d-moved", teamDocumentId: "td-mine" },
    ];
    const originals: ProposedOriginal[] = [
      { documentId: "d-bound", sourcePath: "root/docs/bound.md", active: true },
      { documentId: "d-path", sourcePath: "root/docs/path.md", active: true },
      { documentId: "d-mine", sourcePath: "root/docs/mine.md", active: true },
      { documentId: "d-moved", sourcePath: "root/docs/holder.md", active: true },
    ];

    const notices = await collectPublicationNotices(
      repositoriesWith({ documents, bindings }),
      caller,
      { sourceId: "personal-1", originals, includePathReserved: true },
    );

    expect(notices).toEqual([
      {
        publicationId: publication.id,
        originalDocumentId: "d-bound",
        code: "MAINTAINED_BY_OTHER",
        maintainerUserId: "u2",
        maintainerName: "Mike",
      },
      {
        publicationId: publication.id,
        originalDocumentId: "d-moved",
        code: "PATH_RESERVED",
      },
      {
        publicationId: publication.id,
        originalDocumentId: "d-path",
        sourcePath: "root/docs/path.md",
        code: "MAINTAINED_BY_OTHER",
        maintainerUserId: "u2",
        maintainerName: "Mike",
      },
    ]);
  });
});
