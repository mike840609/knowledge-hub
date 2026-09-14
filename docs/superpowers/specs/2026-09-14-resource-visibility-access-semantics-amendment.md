# Resource Visibility & Access-Denial Semantics Amendment

**Date:** 2026-09-14

**Status:** Accepted pre-Phase-3 amendment

**Applies to:** Phase 2 import-session behavior immediately; Phase 3 production authorization design generally.

## Decision

Knowledge Hub separates **resource discoverability** from **resource readability**.

```text
canDiscover(resource)
├─ false → 404 NOT_FOUND
└─ true
   ├─ canRead(resource) → normal response
   └─ false → 403 ACCESS_DENIED
```

A caller may therefore be told that a resource exists without being allowed to read its protected contents. This is an explicit product contract, not an accidental error-side channel.

## Security boundary

This decision does **not** make arbitrary UUID probing enumerable.

`404 NOT_FOUND` remains mandatory when the system cannot establish that the caller is allowed to discover the resource. Examples include:

- missing IDs;
- foreign creator-private staging resources;
- route-scope mismatches used only as navigation context;
- resources whose parent Workspace/Source is itself undiscoverable to the caller.

`403 ACCESS_DENIED` is allowed only after the application has positive evidence that the caller may know the resource exists. The evidence must come from trusted server-side state, never from a client-provided Workspace ID, source ID, org code, owner metadata, or URL shape.

## Phase 2 import-snapshot rule

Import snapshots remain creator-private temporary resources.

For GET/upload/finalize/apply:

1. Load the snapshot by server-side ID.
2. If it does not exist, return `404 NOT_FOUND`.
3. If `snapshot.created_by !== caller.identity.id`, return `404 NOT_FOUND`.
4. The creator relationship is sufficient discoverability proof for this temporary resource.
5. Re-check current Workspace access.
6. If the creator no longer has Workspace access, return `403 ACCESS_DENIED` and do not expose snapshot contents.
7. If access is still valid, continue normally.

This preserves creator privacy while avoiding the incorrect behavior where a known resource becomes indistinguishable from a missing one after membership is revoked.

## Human Web behavior

The browser must render three distinct states:

```text
unknown / undiscoverable → Not found
known but forbidden      → Access denied
unexpected failure       → Error boundary
```

Authorization failures must never fall through to the generic 500/error-boundary experience.

The API contract is authoritative for HTTP status: discoverable-but-unreadable resources use `403`; undiscoverable resources use `404`.

## Phase 3 authorization model

Phase 3 must model the same split in production governance. At minimum, policy evaluation must be able to answer two questions independently:

- `discover`: may the caller know the resource exists and receive non-sensitive identity/navigation metadata?
- `read`: may the caller receive the protected content/body/revision data?

Roles are only bundles of capabilities; they are not the authorization boundary by themselves.

A caller can therefore be in this valid state:

```text
Workspace discover  ✅
Source discover     ✅
Document discover   ✅
Document read       ❌
```

The UI may show an access-denied/request-access state in that case, but must not leak title/snippet/content unless those fields are explicitly classified as discoverable metadata by the Phase 3 design.

## Invariants retained

- same org != allow;
- cross org != deny;
- Workspace ID/name/owner/org metadata != authorization proof;
- route parameters are navigation scope, never proof of access;
- Workspace membership/capabilities are re-checked at the application boundary;
- Agent/MCP callers must reuse the same discover/read semantics later;
- search/retrieval must not expose content or snippets for resources the caller cannot read.

## Current implementation scope

This amendment immediately changes the concrete Phase 2 import-snapshot case that already has trusted discoverability evidence (`created_by`). It does **not** introduce Phase 3 roles, Source overrides, Document ACLs, or a general discovery-policy engine into Phase 2.

General Workspace/Source/Document discover-vs-read capability evaluation is a Phase 3 responsibility and must be designed before production multi-user rollout.
