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
