# PostgreSQL primary runtime and migration projection

This directory contains the normalized communication-platform schema and its
idempotent migration/reconciliation projection. PostgreSQL is an authorized
single-writer API Repository only when `API_STORAGE_DRIVER=postgres`; startup
still fails closed on the full migration manifest, database identity, signed
cutover evidence, TLS policy, and multi-node readiness.

Current behavior:

- JSON and SQLite remain explicit compatibility drivers; they are not dual
  writers when PostgreSQL is selected.
- The PostgreSQL runtime is the sole write authority for normalized aggregates,
  command/reliable inboxes, outbox, usage, billing, provider operations, Agent,
  recording, ingress, account, payment, voice, terms, and diagnostics data.
- Legacy projection/import is retained for one-time migration and signed
  reconciliation only. PostgreSQL records each projection event ID before
  applying it, so replay after an acknowledgement failure is safe.
- Agent target phone numbers are sealed before they enter projection events,
  import records, normalized tasks, or generic projection records. The opaque
  reference is bound to the owning user and draft and supports key rotation.
- Provider, Recording, Ingress, Agent Step, and Agent Tool idempotency is scoped
  to its owning aggregate rather than globally.
- Recording projection preserves room, participant, and audio-track targets;
  verified artifacts retain content hashes and independent manifest hashes.
- Offline import reuses the same projection functions and records exact JSONB
  state for per-record count/hash reconciliation.
- The schema includes `SKIP LOCKED` reliable-outbox claims, provider-operation
  CAS, aggregate writer leases, and fencing tokens. These are cutover building
  blocks. Migration `015_primary_record_unit_of_work` and
  `PostgresPrimaryStore` now add an asynchronous aggregate transaction that
  serializes by aggregate, locks and validates the current fencing lease,
  applies an idempotent normalized projection mutation with record-level CAS,
  and can enqueue a reliable outbox event in the same PostgreSQL transaction.
- Duplicate projection events no longer advance `projection_records` version;
  outbox idempotency replays compare all persisted content and reject a reused
  key with different content.
- Migrations `017_primary_command_inbox` and `018_reliable_inbox` store command
  results and reserve external events before their domain mutations. The
  reliable inbox persists the first result and rejects changed event reuse.
  The command inbox stores the request hash and first result in the same fenced
  transaction. The asynchronous Provider Operations Repository combines it
  with normalized projection and reliable outbox writes; expired command and
  inbox records have a bounded `SKIP LOCKED` pruning helper.
- Migration `019_usage_accounting` adds versioned usage accounts and holds plus
  an append-only billing ledger. The asynchronous Session and Usage
  repositories require a session or billing-account fence, serialize balances
  by user row, and commit normalized records, command results, and outbox
  events atomically and are connected through the shared Repository runtime.
- Migrations `020_worker_capacity_fencing` and `021_domain_capacity_locks`
  provide explicit cross-session capacity serialization for Worker runtime and
  Ingress. Asynchronous Dispatch, Recording, Artifact, and Ingress
  repositories now use the same fenced command/record/outbox unit of work.
- Migration `022_agent_primary_idempotency` adds request-hash audit columns,
  mode-scoped run attempts, one active run per task/mode, and handoff business
  idempotency. Asynchronous Agent repositories atomically coordinate
  Run, Step, Tool, Handoff, and Consult records under their owning fence.
- Migration `023_aggregate_lease_renewal` keeps the fencing token stable when
  the same live platform instance renews ownership. A token changes only after
  expiry or owner takeover, while advisory transaction locks serialize writes.
- Migration `024_reliable_inbox_leases` adds recoverable claim leases and
  attempt tracking for asynchronous webhook inbox processing.
- Migration `025_agent_phone_reference_security` rejects plaintext in
  `agent_tasks.target_phone_reference`. Agent projection/import requires the
  dedicated `AGENT_PHONE_REFERENCE_*` keyring and fails closed when absent.
- Migration `026_agent_task_primary` adds Task version/request identity,
  owner-scoped idempotency, unique call binding, and queue/reconciliation
  indexes required by the Agent Task primary Repository.
- Migration `027_billing_atomicity` adds fenced payment orders, entitlements,
  notification dedupe, and normalized billing indexes.
- Migration `028_product_records_primary` adds indexed primary records for
  accounts, consents, diagnostics, terms, and voice metadata.
- Migration `029_projection_runtime_compatibility` pins PL/pgSQL conflict
  resolution for the legacy projection function and aligns transcript revision
  constraints with the public non-negative revision contract.
- Migration `030_tts_playback_session_identity` aligns PostgreSQL playback
  identity with SQLite and the session aggregate by using `(session_id, id)`.
- Migration `031_voice_agent_recording_consent` stores authoritative
  participant consent evidence and the Agent Task recording policy used by the
  Agent/Egress runners.
- Migration `037_agent_voice_work` adds the PostgreSQL-only Voice Agent
  background Work store. It separates Work state from reliable event
  publication, enforces scoped `submissionKey` idempotency, bounded
  attempts/runtime/owner concurrency, recoverable `SKIP LOCKED` claims, and
  confirmation-based cancellation. Runtime creation and delivery remain
  disabled until their feature flags are explicitly enabled.
- Migration `038_agent_work_permissions` stores pending permission requests and
  server-authoritative, current-turn authorization snapshots. A Work row must
  reference an active snapshot whose run/session/leg/turn/actor/tool,
  arguments hash, instruction evidence, policy, risk, side effects and scoped
  generations all match; a model-supplied hash alone is never authorization.
- Migration `039_agent_voice_turn_scope` makes the API authoritative for the
  current voice-turn ID and monotonic turn/dispatch generations. Idempotent
  speaking/final/end events invalidate stale permissions and Work before a new
  tool request can be accepted.
- Primary import now includes legacy usage maps, holds, ledger rows, and
  deterministic Agent request-hash/idempotency backfills. Audit compares every
  primary payload, normalized namespace counts, the exact migration manifest,
  and database identity. Cutover evidence is HMAC-signed and bound to an
  explicit cutover ID before startup can accept it.
- Runtime adapters now cover every production Repository consumer and
  `npm run check:postgres-primary-cutover -- --summary` reports `0/0`.
- `npm run postgres:startup-check` verifies the signed evidence, exact migration
  manifest, and database identity without starting the API. Beelink deployment
  runs this admission before replacing the existing application container.
- A post-cutover additive migration must not rerun the legacy SQLite/JSON
  reconciliation against a PostgreSQL primary that has accepted new writes.
  `npm run postgres:upgrade-evidence` authenticates the previous evidence,
  requires an exact schema prefix and a code-owned validator for every added
  migration, verifies the live database identity, and atomically re-signs the
  evidence. The evidence directory must be mounted writable only for this
  administrative command; the application keeps it read-only.
- Compile-time PostgreSQL primary authorization is enabled after isolated
  Beelink staging acceptance. This does not switch existing environments:
  `API_STORAGE_DRIVER` remains explicit, production still requires its own
  verify-full TLS and signed evidence, and multi-node operation remains a
  separate fail-closed gate.

Production/HA acceptance procedure:

1. provision the target PostgreSQL database and least-privilege roles without
   reusing the accepted isolated staging database;
2. set `verify-full` TLS and run every migration in the runtime manifest with
   `npm run postgres:migrate` twice;
3. run `npm run postgres:check`, then `npm run postgres:import`;
4. run `npm run postgres:audit` with `POSTGRES_CUTOVER_EVIDENCE_FILE` pointing
   into the isolated evidence package and set a unique `POSTGRES_CUTOVER_ID`
   plus a separate 32+ character `POSTGRES_CUTOVER_EVIDENCE_HMAC_KEY`;
5. verify copied-data import/replay, count/hash, relationships and rollback
   before selecting `API_STORAGE_DRIVER=postgres`;
6. verify connection loss, Patroni/etcd failover, fencing, old-primary rebuild,
   WAL-G off-host backup/restore and PITR;
7. keep `PLATFORM_MULTI_NODE_ENABLED=false` until the real cross-host topology,
   backup/restore, PITR, capacity and cutover rollback have passed acceptance.

Never point the runtime at production before its signed migration and
reconciliation evidence package exists. PostgreSQL reliable outbox claims use
`SKIP LOCKED`; the legacy local outbox remains single-instance only.
