# Public 1.1 PostgreSQL 046/047 cutover and safe-stop

Status: development runbook only. The current public database has not been migrated by this work, and this is not a deployment authorization.

2026-09-26 clarification: "current public database" below means the original public RC database last evidenced at schema 045, **not** the separate `wujie-co11-qa-54026e7` QA database already running schema 047. The QA currently runs source `e951519` with public runtime and new-session admission disabled. This documentation batch does not restart, migrate, restore or test either database. See [the current handoff](CLOSEOUT_HANDOFF.md).

## Boundary

The existing deployed image expects schema 045. The new source expects 047: migration 046 changes the usage-hold projection's monotonic renewal rule; 047 adds indexed public model-attempt records and their session-delete cleanup. The old image must not simply be restarted after 046/047 because its exact schema manifest and data contract differ. Frozen private 1.0 is not a public data rollback target.

## Before any live migration

1. Freeze one source commit, API/Gateway/Worker image digests, iOS/Android identities, model configuration revision, qualification receipts, pricing and schema-manifest hashes. Verify them against the chosen RC, not against a previous candidate.
2. Stop new public session issuance and establish a trustworthy drain/stop disposition for active sessions and holds. Record the exact nonterminal session, hold, ledger, outbox and attempt counts. Do not resolve unknown stops by synthetic zero-duration endings.
3. Take a consistent PostgreSQL backup and prove a restore into an isolated database. Preserve the backup location, timestamp, content hash, migration version list and operator approval. Do not expose credentials in the handoff.
4. Re-run the current source's schema 047 UOW, 10,000-attempt, duplicate settlement and restart checks against the isolated restore. Check 045→046→047 migration result and the actual serving image's adapter/configuration identity.
5. Obtain the separate authorization for the exact live database, image, maintenance window and supplier-call budget. Only then apply the migrations and start the matched image.

## Failure or rollback decision

- Before any post-cutover public write: if the write freeze is independently proven, an approved restore of the pre-migration backup may return to schema 045 and the old image. The restore itself is a separate destructive/data-change approval.
- After any new write or if write absence is uncertain: **safe-stop online issuance**, keep schema 047 and all records/holds/outbox intact, retain local app data, and repair/roll forward with a schema-047-compatible image. Never drop 047 records or restore an older backup over new customer data merely to start the old image.
- Keep public and private identities/tokens/history separate. A public outage must not silently route a user's online session to private 1.0 or phone-local inference.
- Reopen only after dependency readiness, exact model qualification, end/hold/ledger reconciliation and an explicit rollback decision have been recorded for the same RC.

## Current evidence and missing proof

Migrations 046/047, attempt/settlement UOW, 10,000-attempt pagination and API-process persistence/unique settlement have prior evidence on task-owned isolated databases. The selected QA has schema-047 images retained for an isolated rollback, and e951519 has a time-bounded real silent ASR+MT qualification receipt. These are no longer "missing source/qualification everywhere".

Still missing for formal cutover: an approved and demonstrated restore preserving newly written history/ledger, a precisely chosen compatible rollback target, the complete active Gateway/Provider restart path, exact spoken-combination qualification, and formal same-RC iOS/Android acceptance. The original public RC's latest migration evidence remains 045; it was not reprobed or changed by this documentation batch. Therefore live cutover and release remain blocked, without discarding the existing isolated evidence.
