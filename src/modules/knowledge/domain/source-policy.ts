export const SOURCE_TYPES = ["FOLDER_SYNC", "FILE_UPLOAD", "HUB"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const SOURCE_OWNERSHIPS = ["SOURCE_MANAGED", "HUB_MANAGED"] as const;
export type SourceOwnership = (typeof SOURCE_OWNERSHIPS)[number];

export type SourcePolicy = {
  id: string;
  workspaceId: string;
  sourceType: SourceType;
  ownership: SourceOwnership;
  status: "ACTIVE" | "ARCHIVED";
  syncVersion: number;
};

export function isHubManaged(policy: SourcePolicy): boolean {
  return policy.ownership === "HUB_MANAGED";
}
