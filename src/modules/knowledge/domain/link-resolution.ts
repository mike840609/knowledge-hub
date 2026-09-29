import type { ExtractedLink } from "./document-links";

/**
 * One document a link can point at. The catalog is built from a single
 * Workspace's ACTIVE documents in ACTIVE sources, so nothing outside that
 * Workspace can ever be resolved to (spec §6.4).
 */
export type CatalogDocument = {
  documentId: string;
  sourceId: string;
  /** The current revision's title. */
  title: string;
  /** Path inside the source, `/`-separated; `null` for a Hub document, which has none. */
  sourcePath: string | null;
  createdAt: Date;
};

export type LinkOrigin = {
  documentId: string;
  sourceId: string;
  sourcePath: string | null;
};

export type LinkResolution =
  | {
      status: "RESOLVED";
      documentId: string;
      /** How many other documents matched equally well by name; 0 when the match is unique. */
      ambiguousWith: number;
    }
  | { status: "UNRESOLVED" };

export interface LinkResolver {
  resolve(link: Pick<ExtractedLink, "kind" | "target">, origin: LinkOrigin): LinkResolution;
}

/** How names are compared: Unicode-composed, trimmed, single-spaced, case-folded. */
export function normalizeLinkKey(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

const MARKDOWN_EXTENSION = /\.(?:md|markdown)$/i;

function stripMarkdownExtension(value: string): string {
  return value.replace(MARKDOWN_EXTENSION, "");
}

function fileStem(path: string): string {
  return stripMarkdownExtension(path.slice(path.lastIndexOf("/") + 1));
}

/**
 * Resolves `path` relative to the directory of `fromPath`, within a source.
 * `null` when it climbs out of the source's root, which no document can be at.
 */
export function resolveRelativeSourcePath(fromPath: string, path: string): string | null {
  const segments: string[] = path.startsWith("/") ? [] : fromPath.split("/").slice(0, -1);
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(part);
    }
  }
  return segments.length === 0 ? null : segments.join("/");
}

type Candidate = {
  document: CatalogDocument;
  titleKey: string;
  stem: string;
  stemKey: string;
  /** Extension-less path, folded; `null` for a Hub document. */
  pathKey: string | null;
  depth: number;
};

function rank(left: Candidate, right: Candidate, originSourceId: string, written: string): number {
  const sameSource = Number(right.document.sourceId === originSourceId) - Number(left.document.sourceId === originSourceId);
  if (sameSource !== 0) return sameSource;
  // The title is stored case-sensitively, so a link that spells it exactly is
  // a better match than one that only folds to it.
  const exact = (candidate: Candidate) => Number(candidate.document.title === written || candidate.stem === written);
  const exactMatch = exact(right) - exact(left);
  if (exactMatch !== 0) return exactMatch;
  const titleFirst = Number(right.titleKey === normalizeLinkKey(written)) - Number(left.titleKey === normalizeLinkKey(written));
  if (titleFirst !== 0) return titleFirst;
  if (left.depth !== right.depth) return left.depth - right.depth;
  const older = left.document.createdAt.getTime() - right.document.createdAt.getTime();
  if (older !== 0) return older;
  return left.document.documentId < right.document.documentId ? -1 : left.document.documentId > right.document.documentId ? 1 : 0;
}

/**
 * The resolution rules of spec §6. Built once per request from the catalog,
 * so resolving each link is a map lookup rather than a scan.
 *
 * Deterministic: the same catalog and link always give the same answer,
 * whatever order the catalog was loaded in, because the ranking ends in a total
 * order (creation time, then id).
 */
export function buildLinkResolver(catalog: readonly CatalogDocument[]): LinkResolver {
  const byName = new Map<string, Candidate[]>();
  const byExactPath = new Map<string, Candidate>();
  const byFoldedPath = new Map<string, Candidate[]>();

  const index = (key: string, candidate: Candidate) => {
    const bucket = byName.get(key);
    if (!bucket) byName.set(key, [candidate]);
    else if (!bucket.includes(candidate)) bucket.push(candidate);
  };

  for (const document of catalog) {
    const path = document.sourcePath;
    const stem = path === null ? "" : fileStem(path);
    const candidate: Candidate = {
      document,
      titleKey: normalizeLinkKey(document.title),
      stem,
      stemKey: normalizeLinkKey(stem),
      pathKey: path === null ? null : normalizeLinkKey(stripMarkdownExtension(path)),
      depth: path === null ? 0 : path.split("/").length,
    };
    index(candidate.titleKey, candidate);
    if (path !== null) {
      index(candidate.stemKey, candidate);
      byExactPath.set(`${document.sourceId}\0${path}`, candidate);
      const folded = `${document.sourceId}\0${normalizeLinkKey(path)}`;
      const bucket = byFoldedPath.get(folded);
      if (bucket) bucket.push(candidate);
      else byFoldedPath.set(folded, [candidate]);
    }
  }

  const resolveWiki = (target: string, origin: LinkOrigin): LinkResolution => {
    const written = stripMarkdownExtension(target.trim());
    const key = normalizeLinkKey(written);
    if (key === "") return { status: "UNRESOLVED" };
    let candidates: Candidate[];
    if (key.includes("/")) {
      // Path-qualified: `Notes/Source` matches `x/Notes/Source.md` on whole
      // segments (Obsidian's shortest-path form); a title never does.
      const last = key.slice(key.lastIndexOf("/") + 1);
      candidates = (byName.get(last) ?? []).filter(
        (candidate) => candidate.pathKey !== null && (candidate.pathKey === key || candidate.pathKey.endsWith(`/${key}`)),
      );
    } else {
      candidates = byName.get(key) ?? [];
    }
    if (candidates.length === 0) return { status: "UNRESOLVED" };
    const best = [...candidates].sort((left, right) => rank(left, right, origin.sourceId, written))[0];
    return { status: "RESOLVED", documentId: best.document.documentId, ambiguousWith: candidates.length - 1 };
  };

  const resolvePath = (target: string, origin: LinkOrigin): LinkResolution => {
    // A relative path only means something from a file with a location; a Hub
    // document has none, so its relative links have nothing to be relative to.
    if (origin.sourcePath === null) return { status: "UNRESOLVED" };
    const path = resolveRelativeSourcePath(origin.sourcePath, target);
    if (path === null) return { status: "UNRESOLVED" };
    const exact = byExactPath.get(`${origin.sourceId}\0${path}`);
    if (exact) return { status: "RESOLVED", documentId: exact.document.documentId, ambiguousWith: 0 };
    const folded = byFoldedPath.get(`${origin.sourceId}\0${normalizeLinkKey(path)}`);
    if (!folded || folded.length === 0) return { status: "UNRESOLVED" };
    const best = [...folded].sort((left, right) => rank(left, right, origin.sourceId, path))[0];
    return { status: "RESOLVED", documentId: best.document.documentId, ambiguousWith: folded.length - 1 };
  };

  return {
    resolve(link, origin) {
      return link.kind === "WIKI" ? resolveWiki(link.target, origin) : resolvePath(link.target, origin);
    },
  };
}
