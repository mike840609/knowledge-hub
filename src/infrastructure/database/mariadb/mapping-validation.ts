import { InvalidSourceMappingError } from "@/modules/knowledge/domain/errors";
import type { MigrationReadConnection } from "./migrations/types";

export type FolderMappingInput = Record<string, string>;

export type MappingIssueCode =
  | "INCOMPLETE_MAPPING"
  | "UNKNOWN_NODE"
  | "CROSS_SOURCE_MAPPING"
  | "WRONG_NODE_TYPE"
  | "DOCUMENT_MISMATCH"
  | "DUPLICATE_NODE_MAPPING"
  | "CONFLICTING_MAPPING";

export type MappingIssue = { code: MappingIssueCode; entryId: string | null; message: string };

export type PlannedMappingUpdate = { entryId: string; treeNodeId: string; alreadyApplied: boolean };

export type MappingPreflight = {
  ready: boolean;
  issues: MappingIssue[];
  planned: PlannedMappingUpdate[];
  totalEntries: number;
  pendingUpdates: number;
};

type Queryable = Pick<MigrationReadConnection, "query">;

type EntryRow = {
  id: string;
  sourceId: string;
  entryType: string;
  documentId: string | null;
  treeNodeId: string | null;
};

type NodeRow = {
  id: string;
  sourceId: string;
  nodeType: string;
  documentId: string | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function parseFolderMappingFile(raw: unknown): FolderMappingInput {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new InvalidSourceMappingError("The folder mapping file must be a JSON object with a \"folders\" object.");
  }
  const folders = (raw as Record<string, unknown>).folders;
  if (typeof folders !== "object" || folders === null || Array.isArray(folders)) {
    throw new InvalidSourceMappingError("The folder mapping file must contain a \"folders\" object of entry ID to tree node ID.");
  }
  const result: FolderMappingInput = {};
  for (const [entryId, nodeId] of Object.entries(folders as Record<string, unknown>)) {
    if (!isUuid(entryId)) throw new InvalidSourceMappingError(`Folder mapping entry ID is not a UUID: ${entryId}.`);
    if (!isUuid(nodeId)) throw new InvalidSourceMappingError(`Folder mapping target for entry ${entryId} is not a UUID.`);
    if (result[entryId] !== undefined) throw new InvalidSourceMappingError(`Folder mapping contains a duplicate entry ID: ${entryId}.`);
    result[entryId] = nodeId;
  }
  return result;
}

export function assertFolderTargetNode(nodeType: string, entryId: string): void {
  if (nodeType !== "FOLDER") {
    throw new InvalidSourceMappingError(`SourceEntry ${entryId} is a FOLDER entry but targets a ${nodeType} tree node.`);
  }
}

export async function hasTreeNodeIdColumn(queryable: Queryable): Promise<boolean> {
  const rows = await queryable.query<{ column_name: string }[]>(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'source_entries' AND column_name = 'tree_node_id'",
  );
  return rows.length > 0;
}

async function loadMappingEntries(queryable: Queryable): Promise<EntryRow[]> {
  const columnExists = await hasTreeNodeIdColumn(queryable);
  const treeNodeIdSelect = columnExists ? "tree_node_id" : "CAST(NULL AS CHAR) AS tree_node_id";
  const rows = await queryable.query<{ id: unknown; source_id: unknown; entry_type: unknown; document_id: unknown; tree_node_id: unknown }[]>(
    `SELECT id, source_id, entry_type, document_id, ${treeNodeIdSelect} FROM source_entries ORDER BY id`,
  );
  return rows.map((row) => ({
    id: String(row.id),
    sourceId: String(row.source_id),
    entryType: String(row.entry_type),
    documentId: row.document_id === null ? null : String(row.document_id),
    treeNodeId: row.tree_node_id === null ? null : String(row.tree_node_id),
  }));
}

async function loadTreeNodesById(queryable: Queryable, ids: string[]): Promise<Map<string, NodeRow>> {
  const result = new Map<string, NodeRow>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return result;
  const placeholders = unique.map(() => "?").join(",");
  const rows = await queryable.query<{ id: unknown; source_id: unknown; node_type: unknown; document_id: unknown }[]>(
    `SELECT id, source_id, node_type, document_id FROM knowledge_tree_nodes WHERE id IN (${placeholders})`,
    unique,
  );
  for (const row of rows) {
    result.set(String(row.id), {
      id: String(row.id),
      sourceId: String(row.source_id),
      nodeType: String(row.node_type),
      documentId: row.document_id === null ? null : String(row.document_id),
    });
  }
  return result;
}

async function loadDocumentNodes(queryable: Queryable, pairs: { sourceId: string; documentId: string }[]): Promise<Map<string, NodeRow>> {
  const result = new Map<string, NodeRow>();
  if (pairs.length === 0) return result;
  const placeholders = pairs.map(() => "(?, ?)").join(",");
  const params = pairs.flatMap((pair) => [pair.sourceId, pair.documentId]);
  const rows = await queryable.query<{ id: unknown; source_id: unknown; node_type: unknown; document_id: unknown }[]>(
    `SELECT id, source_id, node_type, document_id FROM knowledge_tree_nodes WHERE (source_id, document_id) IN (${placeholders})`,
    params,
  );
  for (const row of rows) {
    result.set(`${String(row.source_id)}${String(row.document_id)}`, {
      id: String(row.id),
      sourceId: String(row.source_id),
      nodeType: String(row.node_type),
      documentId: row.document_id === null ? null : String(row.document_id),
    });
  }
  return result;
}

function validatePair(entry: EntryRow, node: NodeRow): MappingIssue | null {
  if (node.sourceId !== entry.sourceId) {
    return { code: "CROSS_SOURCE_MAPPING", entryId: entry.id, message: `SourceEntry ${entry.id} belongs to source ${entry.sourceId} but targets tree node ${node.id} from source ${node.sourceId}.` };
  }
  if (node.nodeType !== entry.entryType) {
    return { code: "WRONG_NODE_TYPE", entryId: entry.id, message: `SourceEntry ${entry.id} is a ${entry.entryType} entry but targets a ${node.nodeType} tree node.` };
  }
  if (entry.entryType === "DOCUMENT" && (entry.documentId === null || node.documentId !== entry.documentId)) {
    return { code: "DOCUMENT_MISMATCH", entryId: entry.id, message: `SourceEntry ${entry.id} maps document ${entry.documentId} but targets tree node ${node.id} for document ${node.documentId}.` };
  }
  return null;
}

export async function preflightMapping(queryable: Queryable, folders: FolderMappingInput): Promise<MappingPreflight> {
  const entries = await loadMappingEntries(queryable);
  const issues: MappingIssue[] = [];
  const planned: PlannedMappingUpdate[] = [];
  const targets = new Map<string, string>();
  const documentPairs = entries
    .filter((entry) => entry.entryType === "DOCUMENT" && entry.documentId !== null)
    .map((entry) => ({ sourceId: entry.sourceId, documentId: entry.documentId as string }));
  const documentNodes = await loadDocumentNodes(queryable, documentPairs);

  const wantedNodeIds: string[] = [];
  for (const entry of entries) {
    if (entry.entryType === "DOCUMENT") {
      if (entry.documentId === null) {
        issues.push({ code: "INCOMPLETE_MAPPING", entryId: entry.id, message: `SourceEntry ${entry.id} is a DOCUMENT entry without a document ID.` });
        continue;
      }
      const node = documentNodes.get(`${entry.sourceId}${entry.documentId}`);
      if (!node) {
        issues.push({ code: "INCOMPLETE_MAPPING", entryId: entry.id, message: `SourceEntry ${entry.id} has no DOCUMENT tree node for document ${entry.documentId} in source ${entry.sourceId}.` });
        continue;
      }
      targets.set(entry.id, node.id);
      wantedNodeIds.push(node.id);
    } else {
      const nodeId = folders[entry.id];
      if (!nodeId) {
        issues.push({ code: "INCOMPLETE_MAPPING", entryId: entry.id, message: `SourceEntry ${entry.id} is a FOLDER entry without an operator-provided tree node mapping.` });
        continue;
      }
      targets.set(entry.id, nodeId);
      wantedNodeIds.push(nodeId);
    }
    if (entry.treeNodeId !== null) wantedNodeIds.push(entry.treeNodeId);
  }

  const nodes = await loadTreeNodesById(queryable, wantedNodeIds);
  const claims = new Map<string, string[]>();
  for (const entry of entries) {
    const target = targets.get(entry.id);
    if (entry.treeNodeId !== null && target !== undefined && entry.treeNodeId !== target) {
      issues.push({ code: "CONFLICTING_MAPPING", entryId: entry.id, message: `SourceEntry ${entry.id} already maps to tree node ${entry.treeNodeId} and cannot be remapped to ${target}.` });
      continue;
    }
    if (target === undefined) continue;
    if (entry.treeNodeId === null) {
      planned.push({ entryId: entry.id, treeNodeId: target, alreadyApplied: false });
    } else {
      planned.push({ entryId: entry.id, treeNodeId: target, alreadyApplied: true });
    }
    const effective = entry.treeNodeId ?? target;
    const node = nodes.get(effective);
    if (!node) {
      issues.push({ code: "UNKNOWN_NODE", entryId: entry.id, message: `SourceEntry ${entry.id} targets tree node ${effective} which does not exist.` });
      continue;
    }
    const pairIssue = validatePair(entry, node);
    if (pairIssue) issues.push(pairIssue);
    const key = `${entry.sourceId}${effective}`;
    const claimants = claims.get(key) ?? [];
    claimants.push(entry.id);
    claims.set(key, claimants);
  }
  for (const [key, claimants] of claims) {
    if (claimants.length > 1) {
      for (const entryId of claimants) {
        issues.push({ code: "DUPLICATE_NODE_MAPPING", entryId, message: `Tree node claimed by ${claimants.length} entries in the same source (${key.slice(0, 36)}).` });
      }
    }
  }
  const pendingUpdates = planned.filter((update) => !update.alreadyApplied).length;
  return { ready: issues.length === 0, issues, planned, totalEntries: entries.length, pendingUpdates };
}

export async function checkMappingReadiness(queryable: Queryable): Promise<{ totalEntries: number; mappedEntries: number }> {
  if (!(await hasTreeNodeIdColumn(queryable))) {
    throw new InvalidSourceMappingError("SourceEntry→TreeNode mapping is not ready: migration 004 has not been applied.");
  }
  const entries = await loadMappingEntries(queryable);
  const incomplete = entries.filter((entry) => entry.treeNodeId === null);
  if (incomplete.length > 0) {
    throw new InvalidSourceMappingError(
      `SourceEntry→TreeNode mapping is not ready: ${incomplete.length} of ${entries.length} entries have no tree node mapping. Run the backfill script, then rerun the migration.`,
    );
  }
  const nodes = await loadTreeNodesById(queryable, entries.map((entry) => entry.treeNodeId as string));
  const problems: string[] = [];
  const claims = new Map<string, number>();
  for (const entry of entries) {
    const node = nodes.get(entry.treeNodeId as string);
    if (!node) {
      problems.push(`entry ${entry.id} targets missing tree node ${entry.treeNodeId}`);
      continue;
    }
    const pairIssue = validatePair(entry, node);
    if (pairIssue) problems.push(pairIssue.message);
    const key = `${entry.sourceId}${entry.treeNodeId}`;
    claims.set(key, (claims.get(key) ?? 0) + 1);
  }
  for (const [key, count] of claims) {
    if (count > 1) problems.push(`tree node ${key.slice(36)} is claimed by ${count} entries in the same source`);
  }
  if (problems.length > 0) {
    throw new InvalidSourceMappingError(`SourceEntry→TreeNode mapping is not ready: ${problems.slice(0, 5).join("; ")}${problems.length > 5 ? ` (+${problems.length - 5} more)` : ""}.`);
  }
  return { totalEntries: entries.length, mappedEntries: entries.length };
}
