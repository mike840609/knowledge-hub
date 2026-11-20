# README Open Source Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Help new readers understand and try Knowledge Hub from either README.

**Architecture:** Both READMEs present the same three entry points and preserve their existing reference content below the onboarding path. Deployment details stay in the existing runbooks; the README summarizes who each path is for.

**Tech Stack:** GitHub-flavored Markdown and existing local images.

**Spec:** [README entry points for new users](../specs/2026-11-20-readme-open-source-entry-design.md).

## Global Constraints

- Documentation only; no product behavior or GitHub settings changes.
- Keep English and Traditional Chinese synchronized, with reciprocal links and unchanged setup commands.
- Preserve screenshot provenance and do not add external assets.

## Review Focus

- The hosted demo leads to sign-in; don't promise anonymous access.
- Each local Quick Start and Deployment link lands on the same-language section.
- Graph instructions still make sense with the expanded sidebar.
- Team navigation is opt-in, not labeled “Coming soon.”
- The single-operator Local-identity exception cannot be mistaken for the shared production recommendation.

### Task 1: Refresh the two READMEs and open a docs PR

**Files:** `README.md` and `README.zh-TW.md`.

**Interfaces:** The demo points to `https://knowledge-hub-pied.vercel.app/`. Local setup and deployment links target the existing headings; the identity summaries defer to each language's Vercel runbook and the existing SSO integration section.

- [ ] Record baseline gaps: the first-workflow Graph path, Chinese Team text, Quick Start placement, and Local override wording. Check that the demo URL resolves to sign-in.
- [ ] Put the demo, local Quick Start, and deployment links in the opening; describe folder import and the Notion-inspired block editor alongside the existing reader screenshot. Place Quick Start before the full features table in both languages.
- [ ] Update the Graph path to `Knowledge ▾ → Graph`, remove the stale Team placeholder, and label the screenshot as historical without teaching obsolete breakpoints.
- [ ] Clarify the three deployment paths against the runbooks. Keep the Local override out of shared deployments and the demo distinct from an anonymous sandbox.
- [ ] Check changed links and heading anchors, compare shell code blocks with the baseline, inspect both rendered opening sections, and run `git diff --check`. Confirm the diff contains no product or configuration changes.
- [ ] Commit the documentation and open a dedicated PR against `main`; do not merge.
