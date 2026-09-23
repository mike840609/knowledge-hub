import { ROLE_WORKSPACE_CAPABILITIES } from "@/modules/workspaces/domain/workspace-capability";
import { WorkspaceArchivedError } from "@/modules/workspaces/domain/errors";
import type { WorkspaceRole } from "@/modules/workspaces/domain/workspace-membership";
import {
  DocumentArchivedError,
  DocumentNotFoundError,
  DomainError,
  KnowledgeError,
  NotFoundError,
  SourceArchivedError,
} from "./errors";

/**
 * Document share links (share-link spec). A share link is the single bearer
 * grant in the codebase: an unguessable, expiring, revocable token that a My
 * Space owner issues on purpose, read by exactly one caller-less path.
 *
 * Everything here is pure so that each rule in spec §5.1 and §5.2 can be
 * pinned by a test on its own.
 */

export const SHARE_LINK_EXPIRY_DAYS = [1, 7, 30, 90] as const;
export type ShareLinkExpiryDays = (typeof SHARE_LINK_EXPIRY_DAYS)[number];
export const DEFAULT_SHARE_LINK_EXPIRY_DAYS: ShareLinkExpiryDays = 30;
export const MAX_ACTIVE_SHARE_LINKS_PER_DOCUMENT = 10;
export const MAX_SHARE_LINK_LABEL_LENGTH = 200;

export type DocumentShareLink = {
  id: string;
  documentId: string;
  /** Random UUIDv4, never derived from any entity ID (spec §8). */
  token: string;
  label: string | null;
  createdBy: string;
  createdAt: Date;
  expiresAt: Date;
  revokedBy: string | null;
  revokedAt: Date | null;
};

export class ShareLinkNotPersonalError extends DomainError {
  constructor(message = "Share links are available for My Space documents only.") {
    super("SHARE_LINK_NOT_PERSONAL", message);
    this.name = "ShareLinkNotPersonalError";
  }
}

export class ShareLinkLimitReachedError extends DomainError {
  constructor(message = `A document can have at most ${MAX_ACTIVE_SHARE_LINKS_PER_DOCUMENT} active share links.`) {
    super("SHARE_LINK_LIMIT_REACHED", message);
    this.name = "ShareLinkLimitReachedError";
  }
}

export class InvalidShareLinkExpiryError extends KnowledgeError {
  constructor(message = `Share link expiry must be one of ${SHARE_LINK_EXPIRY_DAYS.join(", ")} days.`) {
    super("INVALID_SHARE_LINK_EXPIRY", message);
    this.name = "InvalidShareLinkExpiryError";
  }
}

export class InvalidShareLinkLabelError extends KnowledgeError {
  constructor(message = `A share link label must be text of at most ${MAX_SHARE_LINK_LABEL_LENGTH} characters.`) {
    super("INVALID_SHARE_LINK_LABEL", message);
    this.name = "InvalidShareLinkLabelError";
  }
}

/** Every unusable link, whatever the reason, is this one error (spec §6.3). */
export class ShareLinkNotFoundError extends NotFoundError {
  constructor(message = "The share link is not available.") {
    super(message, "SHARE_LINK_NOT_FOUND");
    this.name = "ShareLinkNotFoundError";
  }
}

export function isActiveShareLink(link: Pick<DocumentShareLink, "revokedAt" | "expiresAt">, now: Date): boolean {
  return link.revokedAt === null && link.expiresAt.getTime() > now.getTime();
}

type LifecycleStatus = "ACTIVE" | "ARCHIVED";

/** Everything validity depends on, already loaded. Never includes the viewer. */
export type ShareLinkValidityInput = {
  link: Pick<DocumentShareLink, "revokedAt" | "expiresAt">;
  documentStatus: LifecycleStatus;
  sourceStatus: LifecycleStatus;
  workspaceLifecycle: LifecycleStatus | null | undefined;
  /**
   * The creator's DIRECT role on the owning workspace: `undefined` means no
   * row. Group grants cannot be evaluated here — they live in the creator's
   * session, which a viewer does not have (spec §5.2).
   */
  creatorDirectRole: WorkspaceRole | null | undefined;
  now: Date;
};

export type ShareLinkInvalidReason =
  | "REVOKED"
  | "EXPIRED"
  | "DOCUMENT_ARCHIVED"
  | "SOURCE_ARCHIVED"
  | "WORKSPACE_ARCHIVED"
  | "CREATOR_LOST_ACCESS";

function directRoleCanRead(role: WorkspaceRole | null | undefined): boolean {
  if (role === undefined) return false;
  // A NULL role is a pre-bootstrap row that still proves membership; the
  // workspace authorization grants it the baseline VIEWER bundle.
  if (role === null) return true;
  return ROLE_WORKSPACE_CAPABILITIES[role].includes("document.read");
}

/** Reasons are for tests and logs only; callers must never surface them (spec §6.3). */
export function evaluateShareLinkValidity(
  input: ShareLinkValidityInput,
): { valid: true } | { valid: false; reason: ShareLinkInvalidReason } {
  if (input.link.revokedAt !== null) return { valid: false, reason: "REVOKED" };
  if (input.link.expiresAt.getTime() <= input.now.getTime()) return { valid: false, reason: "EXPIRED" };
  if (input.documentStatus !== "ACTIVE") return { valid: false, reason: "DOCUMENT_ARCHIVED" };
  if (input.sourceStatus !== "ACTIVE") return { valid: false, reason: "SOURCE_ARCHIVED" };
  if (input.workspaceLifecycle !== "ACTIVE") return { valid: false, reason: "WORKSPACE_ARCHIVED" };
  if (!directRoleCanRead(input.creatorDirectRole)) return { valid: false, reason: "CREATOR_LOST_ACCESS" };
  return { valid: true };
}

export type ShareLinkCreationInput = {
  callerId: string;
  documentStatus: LifecycleStatus;
  sourceStatus: LifecycleStatus;
  workspace: {
    workspaceType?: "PERSONAL" | "TEAM" | null;
    personalOwnerUserId?: string | null;
    lifecycleState?: LifecycleStatus | null;
  };
  activeLinkCount: number;
  expiresInDays: unknown;
  label: unknown;
};

/**
 * Spec §5.1, first failing rule wins. Ownership (SOURCE_MANAGED /
 * HUB_MANAGED) is deliberately not a rule: sharing is reading, and
 * ownership answers who may write.
 */
export function assertShareLinkCreation(input: ShareLinkCreationInput): { expiresInDays: ShareLinkExpiryDays; label: string | null } {
  if (input.documentStatus !== "ACTIVE") throw new DocumentArchivedError();
  if (input.sourceStatus !== "ACTIVE") throw new SourceArchivedError();
  if (input.workspace.workspaceType !== "PERSONAL") throw new ShareLinkNotPersonalError();
  // Someone else's My Space is not a document this caller may learn about.
  if (input.workspace.personalOwnerUserId !== input.callerId) throw new DocumentNotFoundError();
  if (input.workspace.lifecycleState !== "ACTIVE") throw new WorkspaceArchivedError();
  if (input.activeLinkCount >= MAX_ACTIVE_SHARE_LINKS_PER_DOCUMENT) throw new ShareLinkLimitReachedError();
  return { expiresInDays: normalizeExpiry(input.expiresInDays), label: normalizeLabel(input.label) };
}

function normalizeExpiry(value: unknown): ShareLinkExpiryDays {
  if (value === undefined) return DEFAULT_SHARE_LINK_EXPIRY_DAYS;
  const match = SHARE_LINK_EXPIRY_DAYS.find((days) => days === value);
  if (match === undefined) throw new InvalidShareLinkExpiryError();
  return match;
}

function normalizeLabel(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new InvalidShareLinkLabelError();
  const trimmed = value.trim();
  if (trimmed.length > MAX_SHARE_LINK_LABEL_LENGTH) throw new InvalidShareLinkLabelError();
  return trimmed.length === 0 ? null : trimmed;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function shareLinkExpiry(createdAt: Date, days: ShareLinkExpiryDays): Date {
  return new Date(createdAt.getTime() + days * DAY_MS);
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** UUIDv4 only. Anything else is rejected before a query is issued. */
export function isShareToken(value: string): boolean {
  return UUID_V4.test(value);
}

export function shareLinkPath(token: string): string {
  return `/s/${token}`;
}
