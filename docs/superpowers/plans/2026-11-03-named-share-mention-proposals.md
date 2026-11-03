# Mention Proposals on Named Shares Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A recipient's mention of a non-recipient through a NAMED link becomes a proposal the owner approves or declines; an owner's mention adds the person outright.

**Architecture:** A new `document_share_link_proposals` table behind a `ShareProposalRepository` port. One shared helper adds recipients (used by Manage, owner mentions and approval) so every add writes the same row, audit event and follows. The review service's mention gate splits mentioned ids into admitted / proposed / auto-added; the Inbox gains three proposal kinds judged per request like every other entry.

**Tech Stack:** Next.js 15, TypeScript, MariaDB, Vitest (unit + integration), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-03-named-share-mention-proposals-design.md` (amends `2026-11-03-named-recipient-share-design.md`).

## Global Constraints

- Access is the recipient row only. No read path may consult proposals (`audienceAdmits`, `openShareLinkTarget`, `judgeNamedShares` stay untouched).
- Before approval the proposed person sees proposer name + title only: no comment text, no href, no token.
- Limit `MAX_NAMED_SHARE_RECIPIENTS` = 50; recipient writes count recipients + PENDING proposals; adds count recipients only.
- One row per `(share_link_id, user_id)`; a DECLINED row is final for proposals.
- Every new entry is signed-in only and requires a trusted caller; `tests/unit/share-link-single-exception.test.ts` must keep passing.
- Folder links: entries name the folder ("《name》 folder"), document links the document title.
- Tailwind token names only (`text-body-sm`, `text-caption`, `rounded-md`, …); colours via `kh-*`.
- Shell: `unset -f node npm npx pnpm; export PATH="$HOME/.nvm/versions/node/v24.6.0/bin:$PWD/node_modules/.bin:$PATH"`. Integration: `npx tsx scripts/test/integration.ts <files>`. Typecheck: `node node_modules/typescript/bin/tsc --noEmit`.
- Commit messages end with `Claude-Session: https://claude.ai/code/session_01N59Nahc9HcEo6M1VmoUMa8`.

## Review Focus

1. Race: the proposed person is added directly between the comment's check and its insert → no proposal row is left PENDING for a recipient (Task 3 test "already a recipient makes no proposal"; the add helper also marks PENDING → APPROVED).
2. Proposer removed from the list after proposing → the owner can still approve; the proposer's own APPROVED/DECLINED entry names nothing (dead for them) (Task 4 test).
3. The link is revoked while proposals are pending → all three parties' entries name nothing; approve/decline answer 404 (Tasks 2 and 4).
4. A user mentioned in two threads before approval → approval follows both threads (Task 2 test).
5. Ten mentions in one comment, six of them outsiders, on a link with 46 recipients → refused with the limit message; nothing written (Task 3 test).

---

### Task 1: Proposal storage

**Files:**
- Create: `src/infrastructure/database/mariadb/migrations/031-share-link-proposals.ts`
- Modify: `src/infrastructure/database/mariadb/migrations/index.ts`
- Create: `src/modules/knowledge/domain/share-proposal.ts`
- Create: `src/modules/knowledge/ports/share-proposal-repository.ts`
- Create: `src/infrastructure/database/mariadb/repositories/share-proposals.ts`
- Modify: the `KnowledgeRepositories` type and `createRepositories` (`src/infrastructure/database/mariadb/repositories/index.ts`) to expose `shareProposals`
- Test: `tests/integration/share-proposals-repository.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type ShareProposalStatus = "PENDING" | "APPROVED" | "DECLINED";
  type ShareProposal = { id: string; shareLinkId: string; userId: string; proposedBy: string; commentId: string; status: ShareProposalStatus; createdAt: Date; decidedBy: string | null; decidedAt: Date | null; ownerReadAt: Date | null; proposedReadAt: Date | null; proposerReadAt: Date | null };
  type ProposalParty = "OWNER" | "PROPOSED" | "PROPOSER";
  interface ShareProposalRepository {
    /** False when a row for (link, user) already exists, whatever its status. */
    insertIfAbsent(p: Omit<ShareProposal, "status"|"decidedBy"|"decidedAt"|"ownerReadAt"|"proposedReadAt"|"proposerReadAt">): Promise<boolean>;
    findById(id: string): Promise<ShareProposal | null>;
    lockById(id: string): Promise<ShareProposal | null>;   // SELECT … FOR UPDATE
    listByLink(linkId: string, status?: ShareProposalStatus): Promise<ShareProposal[]>;
    countPending(linkId: string): Promise<number>;
    /** Only from PENDING; true when it changed. */
    decide(id: string, status: "APPROVED" | "DECLINED", by: string, at: Date): Promise<boolean>;
    /** APPROVED for the PENDING row of (link, user), if any. */
    approvePending(linkId: string, userId: string, by: string, at: Date): Promise<void>;
    listForOwner(ownerUserId: string, limit: number): Promise<ShareProposal[]>;   // joins links.created_by
    listForProposed(userId: string, limit: number): Promise<ShareProposal[]>;
    listForProposer(userId: string, limit: number): Promise<ShareProposal[]>;     // decided rows only
    markRead(id: string, party: ProposalParty, at: Date): Promise<void>;
    markAllRead(userId: string, at: Date): Promise<void>;  // every party column where this user is that party
  }
  ```

- [ ] **Step 1: Write the failing integration test** — cases: insert then `insertIfAbsent` again → `false`; `decide` PENDING→DECLINED → `true`, again → `false`; `insertIfAbsent` after DECLINED → `false`; `countPending` counts PENDING only; `approvePending` flips only PENDING; `listForProposer` excludes PENDING; `markRead` sets only the party's column.
- [ ] **Step 2: Run, verify it fails** — `npx tsx scripts/test/integration.ts tests/integration/share-proposals-repository.test.ts` → FAIL (table missing).
- [ ] **Step 3: Migration 031** — table as in the spec's Model section, `UNIQUE KEY uq_share_proposal (share_link_id, user_id)`, `status ENUM('PENDING','APPROVED','DECLINED') NOT NULL`, `KEY ix_proposal_user (user_id, created_at)`, `KEY ix_proposal_by (proposed_by, created_at)`, FKs to `document_share_links`, `users` (×3 incl. `decided_by`), `review_comments(id)`, all `ON DELETE RESTRICT`. Then the domain type, port, adapter, wiring.
- [ ] **Step 4: Run, verify it passes**; `make db-migrate` locally.
- [ ] **Step 5: Commit** `feat(share): store mention proposals`.

### Task 2: One add path; owner approve / decline

**Files:**
- Create: `src/modules/knowledge/application/named-recipients.ts`
- Modify: `src/modules/knowledge/application/document-share-service.ts` (`addRecipients` uses the helper; new methods)
- Create: `src/app/api/share-links/[linkId]/proposals/route.ts` (GET), `src/app/api/share-links/[linkId]/proposals/[proposalId]/approve/route.ts`, `.../decline/route.ts` (POST, 204), following `recipients/route.ts`
- Test: `tests/integration/share-proposals-decide.test.ts`

**Interfaces:**
- Consumes: Task 1 `ShareProposalRepository`.
- Produces:
  ```ts
  // named-recipients.ts — the only place recipient rows are inserted.
  export async function addNamedRecipients(r: KnowledgeRepositories, caller: CallerContext, link: DocumentShareLink, workspaceId: string, userIds: readonly string[], at: Date): Promise<string[] /* actually added */>;
  // DocumentShareService
  listProposals(caller: CallerContext, linkId: string): Promise<ShareProposalView[]>;   // PENDING only
  approveProposal(caller: CallerContext, linkId: string, proposalId: string): Promise<void>;
  declineProposal(caller: CallerContext, linkId: string, proposalId: string): Promise<void>;
  export type ShareProposalView = { id: string; userId: string; name: string; nameEn: string | null; empId: string; orgCode: string; proposedByName: string | null; createdAt: Date };
  export const SHARE_PROPOSAL_DECLINED_EVENT = "DOCUMENT_SHARE_PROPOSAL_DECLINED";
  ```
- `addNamedRecipients`: limit check (recipients only) throws the existing message; `insertRecipients`; `SHARE_RECIPIENT_ADDED_EVENT` per person; `approvePending` per person; for each added person, a follow (via `followForMention`, as `mentionOnWrite` does) on every thread where a stored mention through this link names them.
- approve/decline: `lockOwnedLink` (owner only, else 404), revoked → 404, `lockById` proposal must belong to the link and be PENDING, else 404; repeating the same decision on an already-decided proposal → 204 no-op. Approve = `addNamedRecipients([userId])` (limit failure leaves it PENDING) then `decide APPROVED`; decline = `decide DECLINED` + audit event.

- [ ] **Step 1: Failing tests** — approve adds the recipient row, emits `DOCUMENT_SHARE_RECIPIENT_ADDED`, follows both threads the person was mentioned in, proposal `APPROVED`; decline → `DECLINED` + audit, no row; proposer (a recipient) approving → `ShareLinkNotFoundError`; revoked link → not-found; approve at 50 recipients → limit error and still PENDING; `addRecipients` from Manage for a pending person marks it APPROVED; existing `named-share-management` tests still pass.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** helper, service methods, three routes.
- [ ] **Step 4: Run** `tests/integration/share-proposals-decide.test.ts tests/integration/named-share-management.test.ts tests/integration/named-share-recipient-list.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(share): approve or decline a proposed recipient`.

### Task 3: Mention write path and candidates

**Files:**
- Modify: `src/modules/knowledge/application/document-review-service.ts` (`mentionLink`, `mentionOnWrite`, `mentionLinksForOwner`, `searchMentionCandidates`/candidate method at ~line 155)
- Test: `tests/integration/named-share-mention-proposals.test.ts`

**Interfaces:**
- Consumes: Task 1 port, Task 2 `addNamedRecipients`.
- Produces: `mentionLink` returns `{ linkId: string; propose: string[]; add: string[] } | null` in place of `string | null`; candidates gain `needsApproval: boolean` (owner caller: always `false`).

Rules (spec "Write path"):
- Writer is the Workspace owner (`s.workspace.personalOwnerUserId === caller.identity.id`), NAMED link: non-recipients → `add`; `recipients + add > 50` → existing limit error before anything is written. After the comment insert, `addNamedRecipients(add)` then mentions/follows as today.
- Writer is a recipient, NAMED link: non-recipients without any proposal row → `propose`; `recipients + countPending + propose > 50` → limit error. After the comment insert: `insertIfAbsent` per person with `proposedBy = caller`, `commentId = comment.id`. Mentions inserted for everyone; `followForMention` only for admitted people.
- `MENTION_NOT_RECIPIENT` is no longer thrown.
- `mentionLinksForOwner`: drop the `admitsAll` filter; NAMED links listed whenever valid. Return `{ id, label, audience }` so the picker can warn.
- Candidates on a NAMED link: recipients matching first (`recipientsMatching`), then `searchExisting` fill to `MENTION_LIMIT`, deduped; `needsApproval = !isRecipient && caller is not owner`.

- [ ] **Step 1: Failing tests** — recipient mentions outsider → 201, mention row, one PENDING proposal, outsider: `readShared`/Hub reader/review query all not-found, no follow; mention same outsider again (other thread) → still one proposal; outsider already DECLINED → no new row; outsider already a recipient → no proposal; owner via Hub reader mentions outsider → recipient added, follow exists, pending proposal → APPROVED; owner via Workspace view with `mentionLinkId` of a NAMED link → added; Review Focus 5 (limit, nothing written); candidates include outsiders flagged `needsApproval: true` for a recipient caller and `false` for the owner. Update `named-share-review.test.ts` cases that asserted `MENTION_NOT_RECIPIENT` to the new behaviour.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** this file plus `named-share-review`, `review-mentions`, `folder-share-mentions` → PASS.
- [ ] **Step 5: Commit** `feat(review): mention outsiders on a named share as proposals`.

### Task 4: Inbox entries

**Files:**
- Modify: `src/modules/knowledge/domain/share-comment-event.ts` (kind union + `proposalId?`, `proposalStatus?`, `personName?`)
- Modify: `src/modules/knowledge/application/document-review-service.ts` (`listActivityForOwner`, `listUnreadForOwner`, `countUnreadForOwner`, mark-read entry points, `mentionViews`)
- Test: `tests/integration/named-share-proposal-inbox.test.ts`

**Interfaces:**
- Produces: kinds `"PROPOSAL_REQUEST" | "PROPOSAL_PENDING" | "PROPOSAL_DECIDED"`; id prefix `PROPOSAL_PREFIX = "proposal:"` + `<party>:` + proposal id; fields `proposalId`, `proposalStatus: ShareProposalStatus`, `personName` (the proposed person, for owner/proposer entries).

Rules (spec "Inbox"):
- OWNER: PENDING → `PROPOSAL_REQUEST` (authorName = proposer, personName, documentTitle via `namedShareTitle`), unread until `ownerReadAt` or decided.
- PROPOSED: PENDING → `PROPOSAL_PENDING`; DECLINED → `PROPOSAL_DECIDED` (status DECLINED). APPROVED → nothing (they have `SHARED_WITH_YOU`). Never `excerpt`, `href`, `token`.
- PROPOSER: APPROVED or DECLINED → `PROPOSAL_DECIDED` with `personName`.
- Judged per request: link revoked / target gone → entry names nothing (`linkAvailable: false`, empty title), never unread, approve hidden.
- `mentionViews` skips a dead mention whose `(shareLinkId, mentionedUserId)` has a PENDING or DECLINED proposal.
- Mark-all-read and per-entry read cover the new ids.

- [ ] **Step 1: Failing tests** — each party's entry after propose / approve / decline with the exact fields above; proposed person's entries contain no comment body (assert `JSON.stringify(view)` lacks the body); count matches list; revoked link (Review Focus 3) and removed proposer (Review Focus 2) name nothing; dead mention hidden while pending, live after approval.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** this file plus `named-share-inbox.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(inbox): proposal entries for owner, proposed and proposer`.

### Task 5: UI

**Files:**
- Modify: `src/components/knowledge/notification-href.ts` (labels: "Wants to add someone", "Waiting for owner", "Owner declined" / "Owner approved"; proposal kinds are not link entries)
- Modify: `src/components/knowledge/inbox-activity-view.tsx` (PROPOSAL_REQUEST row: Approve / Decline buttons calling Task 2 routes, then refresh; other proposal rows: text only, no link)
- Modify: `src/components/knowledge/named-share-recipients.tsx` (a "Pending approval" list above the recipients: name · empId · nameEn, orgCode right-aligned as in `recipient-picker.tsx`, "proposed by X", Approve / Decline)
- Modify: `src/components/knowledge/mention-autocomplete.tsx` (`Candidate` gains `needsApproval?: boolean`; shows a muted `text-caption` "Needs owner approval" on such rows)
- Modify: the owner's mention-link picker in `review-composer.tsx` / `owner-review-panel.tsx` (NAMED option says "Adds people not yet on it")
- Test: `tests/unit/named-share-proposals-ui.test.tsx`, existing `tests/unit/mention-autocomplete.test.tsx`

Copy (exact):
- Owner: `{proposer} wants to add {person} to 《{title}》`
- Proposed, pending: `{proposer} mentioned you in 《{title}》 — someone proposed sharing a document with you. Waiting for the owner.`
- Proposed, declined: `The owner declined sharing 《{title}》 with you.`
- Proposer: `The owner added {person} to 《{title}》.` / `The owner declined adding {person} to 《{title}》.`

- [ ] **Step 1: Failing unit tests** — inbox renders each copy line; Approve posts to `/api/share-links/{linkId}/proposals/{id}/approve` once and disables while busy; pending/declined rows have no link; Manage lists pending with org right-aligned and both buttons; autocomplete row shows "Needs owner approval" only when `needsApproval`.
- [ ] **Step 2: Run, verify fail** — `npx vitest run --config vitest.config.ts tests/unit/named-share-proposals-ui.test.tsx tests/unit/mention-autocomplete.test.tsx`.
- [ ] **Step 3: Implement** (the `PROPOSAL_REQUEST` view needs `linkId`; add `shareLinkId` to the view for that kind only, owner-only).
- [ ] **Step 4: Run** full unit suite, tsc, lint → green.
- [ ] **Step 5: Commit** `feat(share): approve proposals from the Inbox and Manage`.

### Task 6: End to end and contract docs

**Files:**
- Modify: `tests/e2e/zz-named-share.spec.ts` (new test)
- Modify: `CLAUDE.md` (NAMED invariant sentence per spec "Invariant text to change")
- Modify: `docs/superpowers/specs/2026-11-03-named-recipient-share-design.md` ("Discussions and mentions": pointer to the proposals spec; the refused-mention bullet marked superseded)

- [ ] **Step 1: e2e** — reviewOwner shares NAMED with nonCreator; nonCreator comments mentioning viewer (picked from the composer, row shows "Needs owner approval"); viewer's Inbox shows the pending copy and not the comment text, and `/s/<token>/open` does not show the document; reviewOwner approves from the Inbox; viewer opens the share from "Shared with you" and sees the comment.
- [ ] **Step 2: Run** `npx tsx scripts/test/e2e.ts tests/e2e/zz-named-share.spec.ts` → PASS.
- [ ] **Step 3: Docs edits.**
- [ ] **Step 4: `make verify`-equivalent** (unit, tsc, lint) + full integration run → green.
- [ ] **Step 5: Commit** `test(share): proposal flow end to end; update the named-share contract`.
