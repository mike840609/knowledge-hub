export const KNOWLEDGE_LIFECYCLES = ["ACTIVE", "ARCHIVED"] as const;
export type KnowledgeLifecycle = (typeof KNOWLEDGE_LIFECYCLES)[number];

export function isActive(status: KnowledgeLifecycle): boolean {
  return status === "ACTIVE";
}
