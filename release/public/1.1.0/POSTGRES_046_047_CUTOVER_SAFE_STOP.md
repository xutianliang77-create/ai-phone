# Public 1.1 PostgreSQL 046/047 cutover and safe-stop

Status (2026-09-29): documentation reconciled; no database, service, restore or rollback action was performed in this documentation batch. This is not deployment authorization.

The original public RC database was last evidenced at schema 045 and was not reprobed here. It is **not** the separate `wujie-co11-qa-54026e7` QA database with schema 047 evidence. The selected QA's last verified source is a7e7532; both current-source real model qualifications and the iOS 2026092902 affected-case signoff are in [the current handoff](CLOSEOUT_HANDOFF.md). Earlier e951519/disabled-entry statements are historical, not current instructions.

## Boundary

The original schema-045 public RC image and the selected schema-047 QA image must be distinguished. Migration 046 changes the usage-hold projection's monotonic renewal rule; 047 adds indexed public model-attempt records and their session-delete cleanup. A schema-045 image must not simply be restarted over 046/047 data. Frozen private 1.0 is not a public data rollback target.

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

Migrations 046/047, attempt/settlement UOW, 10,000-attempt pagination and API-process persistence/unique settlement have version-scoped isolated-database evidence. Controlled active Gateway graceful stop and subsequent persistence also have prior evidence; this is not lossless hard-crash Provider resume. The selected a7e7532 QA has both new real model qualifications and an accepted short iOS silent case. Retained rollback asset `wujie-co11-qa-54026e7-app-pre-a7e7532` belongs to prior 0118b8f/schema047, not frozen private 1.0. Retention alone does not certify a rollback.

Formal cutover still needs the exact target/channel decision, data-preserving backup/restore or safe-stop evidence, compatible image/configuration/qualification validation at the intended time, and remaining applicable iOS/Android/duplex release acceptance. Do not relist the selected QA's spoken qualification as absent, or invent cross-process lossless Provider migration as a new documentation prerequisite. Neither database was changed by this batch.
