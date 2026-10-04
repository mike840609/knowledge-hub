# Phase 3 Authorization Clarification — Discover vs Read

**Date:** 2026-09-14

**Status:** Accepted clarification to the Phase 0–9 roadmap before Phase 3 design.

**Related roadmap:** `docs/superpowers/roadmaps/2026-09-10-knowledge-hub-phase-roadmap.md`

**Canonical policy amendment:** `docs/superpowers/specs/2026-09-14-resource-visibility-access-semantics-amendment.md`

## Phase 3 design constraint

Phase 3 production governance must distinguish whether a caller may **discover** a resource from whether the caller may **read** its protected content.

```text
canDiscover(resource)
├─ false → 404 NOT_FOUND
└─ true
   ├─ canRead(resource) → normal response
   └─ false → 403 ACCESS_DENIED / request-access UX
```

The Phase 3 role/capability model must therefore be able to express `discover` and `read` independently. Roles are bundles of capabilities; they are not themselves the resource boundary.

A valid state is:

```text
Workspace discover  ✅
Source discover     ✅
Document discover   ✅
Document read       ❌
```

In that state, Human Web may render an access-denied or request-access experience, but protected content, snippets, revision bodies, and any metadata not explicitly classified as discoverable must remain hidden.

## Security rules retained

- missing or undiscoverable resource → non-enumerating `404`;
- arbitrary UUID guessing must not establish discoverability;
- client-provided Workspace/Source IDs, route shape, org metadata, owner metadata, or names are never authorization proof;
- same org does not imply allow; cross org does not imply deny;
- Workspace/Source/Document policy remains the canonical authorization truth;
- Phase 4 search and Phase 7 MCP must reuse the same discover/read distinction rather than inventing separate visibility rules.

## Phase 2 bridge

Phase 2 import snapshots already have one trusted discoverability proof: `snapshot.created_by == caller.identity.id`.

Therefore the pre-Phase-3 bridge behavior is:

- missing snapshot → `404 NOT_FOUND`;
- foreign creator-private snapshot → `404 NOT_FOUND`;
- creator-owned snapshot + current Workspace access → normal operation;
- creator-owned snapshot + revoked Workspace access → `403 ACCESS_DENIED` and no snapshot content disclosure.

This clarification supersedes the earlier assumption that every authorization failure must collapse to `404` and is the authorization contract Phase 3 must build upon.
