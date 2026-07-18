# Production PostgreSQL resilience gate

This gate is deliberately separate from the Beelink dedicated staging profile.
Same-host streaming replication and a same-disk WAL archive cannot satisfy it.

Production acceptance requires all of the following in an isolated staging
environment that matches the production topology:

- at least two PostgreSQL nodes on different physical hosts and failure domains;
- managed HA or Patroni/etcd automatic leader election, a fenced old primary,
  endpoint/service-discovery switch, and rebuild/rejoin of the old primary;
- encrypted WAL and base backups stored in off-host object storage, with retention,
  immutability, archive-lag alerting, and a restore sourced from that remote copy;
- RPO/RTO measurements inside the approved objectives;
- the independent 25/50/100 capacity gate and a 120-minute real mixed-traffic soak;
- immutable evidence files whose SHA-256 values are recorded in the result manifest.

Copy `result.example.json` into the ignored `outputs/postgres-resilience/` evidence
directory. Do not change `status` to `passed` from configuration alone; populate it
only from measured failover, restore, and soak results.

The preferred production mode remains the repository topology contract's
`managed_ha`. A self-hosted `patroni_etcd` result is accepted only with at least
three DCS voters across three failure domains. Credentials, bucket names, database
URLs, private keys, and provider tokens must not be committed.

## Provider adapters and executable drill

Copy `drill.example.json` to the private `drill.json` only after choosing either
managed HA or Patroni/etcd and provisioning the second failure domain and
off-host backup target. Provider credentials remain in the execution
environment; the config contains only executable names, argument arrays, public
node identities, and acceptance limits.

The drill runs this fixed sequence:

1. verify the current writer and a write probe using `verify-full`;
2. create an encrypted immutable off-host base backup and verify WAL archive lag;
3. trigger health-controller failover and measure RPO/RTO;
4. prove old-primary write rejection, service-discovery switch, and new-writer access;
5. rebuild the old primary and rejoin it only as a standby on the new timeline;
6. restore from the off-host copy into a distinct `ai_phone_restore_*` database;
7. verify checksum equality, recovery target, and write isolation.

Every command is executed without a shell and must emit one JSON attestation.
The runner refuses to start unless the topology is verified, the real mixed-load
capacity result has passed, the source database is exactly `ai_phone_staging`,
the restore target is distinct, TLS is `verify-full`, and the destructive
acknowledgement matches exactly.

```bash
export POSTGRES_RESILIENCE_STAGING_ACK=WUJIE_POSTGRES_RESILIENCE_STAGING_ONLY
npm run postgres:resilience-drill -- \
  --config infra/postgres/production-resilience/drill.json \
  --promote-latest
```

This repository supplies the orchestration and fail-closed evidence contract.
It deliberately does not select a cloud provider, second host, bucket, KMS key,
or Patroni DCS on behalf of the operator.

## Concrete Patroni and WAL-G integration

`patroni-walg.drill.example.json` binds the fixed drill to the repository's
concrete adapters. Copy it and both provider examples to ignored private files,
replace every executable path and SHA-256, then install `probe-table.sql` only in
`ai_phone_staging`. The adapters never invoke a shell and pass only named
environment variables to `patronictl`, `psql`, `pg_dump`, WAL-G and controllers.

The Patroni adapter requires two database hosts across two failure domains and a
healthy three-voter DCS across three failure domains. Its pinned controllers must
attest DCS quorum, perform a bounded failure injection, and recover the old
primary. The adapter independently checks Patroni leadership, the durable write
probe, old-primary read-only/isolation, writer service discovery and timeline
rejoin. An ambiguous failure request is not replayed automatically.

The WAL-G adapter supports exactly one configured `WALG_S3_PREFIX`,
`WALG_GS_PREFIX` or `WALG_AZ_PREFIX`. A pinned storage controller must inspect the
real remote objects and attest TLS, at-rest encryption, retention, object lock and
version IDs. A pinned recovery controller owns the isolated PostgreSQL lifecycle;
the adapter itself runs `backup-push`, `wal-show`, `backup-fetch`, forces a WAL
switch, and compares bounded streaming SHA-256 values from `pg_dump` on source and
restore. The source must be drained for the restore checksum window; a live write
during that window correctly fails the equality gate.

Provider/controller stdout is a single JSON object. Secrets must be supplied only
through the allowlisted environment variables; stdout/stderr evidence is mode
`0600` and secret-looking values are redacted. The example SHA values are inert
placeholders and must never be treated as deployment evidence.

Before any real drill, run the read-only provider readiness gate. It does not
connect to PostgreSQL, Patroni, DCS or object storage and never invokes a provider
command. It validates private-file binding, executable hashes and permissions,
the exact per-step environment allowlist, controller argument routing, the real
`pg_service.conf` database/host/`verify-full` entries, required secret presence,
an empty restore PGDATA and cross-file topology/database/retention consistency.

```bash
npm run check:postgres-resilience-providers -- \
  --drill infra/postgres/production-resilience/drill.json \
  --patroni infra/postgres/production-resilience/patroni-ha-provider.json \
  --walg infra/postgres/production-resilience/walg-backup-provider.json
```

`ready` means only that the local provider contract is safe to start; it is not
failover, backup, restore, RPO/RTO or production acceptance evidence.

## Controller contract conformance

Before private controllers and infrastructure are available, the seven JSON
attestation contracts can be exercised in isolation. The default command uses a
built-in synthetic fixture; `--fixture` accepts output assembled from an isolated
controller harness such as `controller-conformance.example.json`.

```bash
npm run check:postgres-resilience-controller-contracts
npm run check:postgres-resilience-controller-contracts -- \
  --fixture infra/postgres/production-resilience/controller-conformance.example.json
```

Every simulated attestation must contain `simulationOnly: true`. The production
Patroni and WAL-G Provider paths reject that marker before accepting any result.
Consequently, a passing conformance report is always `promotable: false`: it
validates field types, exact WAL/restore binding and the simulation fence, but it
cannot satisfy a real DCS, failover, backup, restore or production resilience gate.
