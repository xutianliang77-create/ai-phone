# PostgreSQL incremental projection

This directory contains the normalized communication-platform schema and its
idempotent shadow-projection functions. It is not yet the primary API
Repository and does not authorize multi-node writes.

Current behavior:

- JSON or SQLite remains the only write authority.
- Each persisted aggregate change appends a unique local projection event.
- One API projection worker applies events in order.
- PostgreSQL records each event ID before applying it, so replay after a local
  acknowledgement failure is safe.
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
  an append-only billing ledger. The dormant asynchronous Session and Usage
  repositories require a session or billing-account fence, serialize balances
  by user row, and commit normalized records, command results, and outbox
  events atomically. They are source-complete building blocks, not a runtime
  driver switch.
- Migrations `020_worker_capacity_fencing` and `021_domain_capacity_locks`
  provide explicit cross-session capacity serialization for Worker runtime and
  Ingress. Dormant asynchronous Dispatch, Recording, Artifact, and Ingress
  repositories now use the same fenced command/record/outbox unit of work.
- Migration `022_agent_primary_idempotency` adds request-hash audit columns,
  mode-scoped run attempts, one active run per task/mode, and handoff business
  idempotency. Dormant asynchronous Agent repositories atomically coordinate
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
- Primary import now includes legacy usage maps, holds, ledger rows, and
  deterministic Agent request-hash/idempotency backfills. Audit compares every
  primary payload, normalized namespace counts, the exact migration manifest,
  and database identity. Cutover evidence is HMAC-signed and bound to an
  explicit cutover ID before startup can accept it.
- Runtime adapters now cover every production Repository consumer and
  `npm run check:postgres-primary-cutover -- --summary` reports `0/0`.
- `API_STORAGE_DRIVER=postgres` remains fail-closed because compile-time primary
  authorization is intentionally false until the isolated Beelink staging
  database completes migration, replay, fault, rollback, and least-privilege
  acceptance. Multi-node operation remains separately disabled.

Deferred Beelink/staging procedure:

1. provision an isolated PostgreSQL database and least-privilege roles;
2. set TLS verification and run all 30 migrations with
   `npm run postgres:migrate` twice;
3. run `npm run postgres:check`, then `npm run postgres:import`;
4. run `npm run postgres:audit` with `POSTGRES_CUTOVER_EVIDENCE_FILE` pointing
   into the isolated evidence package and set a unique `POSTGRES_CUTOVER_ID`
   plus a separate 32+ character `POSTGRES_CUTOVER_EVIDENCE_HMAC_KEY`;
5. enable the projection against copied staging data;
6. verify backlog drain, event replay, count/hash, relationships, connection
   loss, and failover;
7. keep `PLATFORM_MULTI_NODE_ENABLED=false` until a real PostgreSQL primary
   Repository, atomic claim paths, backup/restore, PITR, and cutover rollback
   have passed acceptance.

Never point this worker at production before the staging migration and shadow
reconciliation evidence package exists. The local outbox is durable but is not
a distributed queue and must not be consumed by multiple API instances.
