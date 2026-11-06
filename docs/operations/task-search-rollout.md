# Task Search rollout and recovery

Status: PR #336, **in progress**. Do not enable the search read path until all
Tasks 1–6 are implemented, checked and deployed. This runbook is not a claim
that backfill or production activation was performed.

## Deploy and cut over

1. Keep `TASK_SEARCH_READ_ENABLED=false` in **all** application instances.
   The original My Space → Tasks list reads directly from immutable task
   revisions and remains available while the search projection is incomplete.
2. Deploy MariaDB migration 034 (creates `task_result_search`) before routing
   any export writes to the new code. Deploy the Task 2 writer to **every**
   writer instance; never backfill while an old writer can commit unindexed
   new revisions. Check rollouts, serverless aliases, workers and any old
   deployment still receiving requests. Do not enable the read flag yet.
3. Run `npx tsx scripts/db/backfill-task-search.ts --target dev --check`
   to see missing/stale projection rows. Use the correct target's database
   configuration; `dev` may use `KM_DB_URL` for the configured deployment.
4. Run `npx tsx scripts/db/backfill-task-search.ts --target dev --run --batch-size 100`.
   You may use `--max-batches 5` to bound one operation. It is safe to
   interrupt and rerun: each result is processed transactionally under the
   existing Task row lock, from the latest committed artifact. A stale batch
   cannot overwrite a larger revision number. Repeated runs are idempotent.
5. Repeat `--check` **after** all the batches finish; ensure the JSON output
   reports `missing:0, mismatched:0, complete:true`. This is a single
   database-statement consistency check, not an audit of which versions of
   the writers are deployed. Confirm all writers are upgraded separately.
   Repeat the check immediately before read cutover.
6. Only after all checks pass, coordinate `TASK_SEARCH_READ_ENABLED=true`
   for **all reader instances**, with a complete deployment/redeploy as
   appropriate to the platform. Test owner/foreign Workspace behavior and
   compare legacy and indexed reads before considering this complete.

## If a stage fails

- **Backfill fails/interrupted:** leave `TASK_SEARCH_READ_ENABLED=false`;
  inspect the error and rerun bounded batches. Do **not** delete or rewrite
  task artifacts. An interrupted backfill does not hide Tasks on the legacy
  reader.
- **Search read errors after cutover:** roll back the feature flag to
  `false` on **all readers** (for Vercel, promote a validated deployment
  with the flag off, or redeploy with the previous setting). This returns
  to the original Tasks listing without removing projections or history.
  Validate the rollback path. The flag is read server-side only.
- **Mixed writer versions:** keep the flag off, upgrade every writer, rerun
  backfill/consistency and only then retry cutover.
- **Slow search:** SQL uses `SET STATEMENT max_statement_time=5` and responds
  without leaking query text. Collect scoped `EXPLAIN` plans with realistic
  100, 1,000 and 10,000-task datasets before choosing any secondary index.
  The initial schema deliberately has no speculative global sort index.

## Scope

The search projection is derived from the **latest** immutable artifact.
Search reads require a verified caller, an ACTIVE owned PERSONAL Workspace and
SQL predicates on both Workspace and owner. A revoked export binding's task
history remains visible to its owner; export credentials do not authorize reads.

