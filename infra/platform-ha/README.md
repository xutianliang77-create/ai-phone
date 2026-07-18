# Platform HA and capacity contract

This directory is a release-blocking topology contract, not proof that the
platform has passed HA or 100-session acceptance.

Copy `topology.example.json` to the private environment-specific
`topology.json`, replace every endpoint, and keep `status` as
`candidate_unverified` until staging completes all gates. The checker requires:

- two CN-resident regions and at least one region accepting new sessions;
- independent API, LiveKit, SIP, Translation, Agent, Egress, and Ingress pools;
- managed PostgreSQL/Redis HA and a single writer per aggregate;
- home-region sticky placement, region-local TURN, and failover for new
  sessions only;
- required OTLP trace export, provider-operation trace linkage, and aggregate
  fencing before multi-node writes;
- admission control before 90% utilization;
- 25/50/100-session steps, a 120-minute soak, zero duplicated provider side
  effects, and zero lost final events.

Do not enable multi-node writes while SQLite/JSON remains the primary store.
The current PostgreSQL path is an incremental shadow projection and must pass
migration, replay, count/hash, failover, and single-writer cutover acceptance
before `API_STORAGE_DRIVER=postgres` can become a supported release setting.

Static check (no service connection):

```bash
npm run check:platform-topology -- \
  --file infra/platform-ha/topology.json \
  --json
```

Release check additionally requires `status=verified`. That status may be set
only after the deferred Beelink/staging capacity and failure-injection runs.

Capacity evidence is a second, independent release gate. Copy
`capacity-result.example.json` into the ignored evidence directory only after
the staging run, fill it from measured results, and keep every referenced log,
trace, and metric file in the same evidence package:

```bash
npm run check:platform-capacity -- \
  --topology infra/platform-ha/topology.json \
  --file outputs/platform-capacity/latest.json \
  --json
```

The checker binds the result to the verified topology SHA-256 and refuses
missing evidence, skipped stages, duplicate provider effects, duplicate
settlements, lost final events, an incomplete soak, or an overload run that did
not demonstrate bounded rejection.

## Real mixed-traffic runner

Copy `mixed-load.example.json` to the private environment-specific
`mixed-load.json`. Replace every command with an isolated staging runner that
drives the real provider. The orchestrator does not invoke a shell and passes
the run, phase, scenario, target concurrency, duration, API URL, and allowlisted
PSTN targets through `PLATFORM_LOAD_*` / `MIXED_LOAD_PSTN_ALLOWLIST` environment
variables.

Each scenario command must remain alive for the requested phase duration and
emit exactly one JSON document on stdout. A successful real attestation must
contain:

```json
{
  "schemaVersion": 1,
  "status": "passed",
  "environment": "staging",
  "realProviderTraffic": true,
  "observedDurationMs": 1800000,
  "trafficKinds": ["api", "livekit", "asr", "mt", "tts"],
  "providerEvidence": {
    "api": ["trace-id"],
    "livekit": ["room-name"],
    "asr": ["speech-id"],
    "mt": ["turn-id"],
    "tts": ["playback-id"]
  },
  "finalEventObserved": true,
  "providerSideEffectDuplicates": 0,
  "lostFinalEvents": 0,
  "duplicateSettlements": 0,
  "metrics": { "sessionStartMs": 900, "finalLatencyMs": 1300 }
}
```

The system probe runs after ramp-up while sessions are still active and must emit
`observedUtilization`, `oomCount`, and
`unboundedQueueObserved`. Failure commands must emit `status=passed`,
`recovered=true`, and `observedRecoverySeconds`. Mock attestations are written as
`mock_passed` and cannot be promoted into `latest.json`.

```bash
export MIXED_LOAD_STAGING_ACK=WUJIE_STAGING_LOAD_ONLY
export MIXED_LOAD_PSTN_ALLOWLIST=+8613800138000
npm run platform:mixed-load -- \
  --config infra/platform-ha/mixed-load.json \
  --promote-latest
```

Never run this against production endpoints or a non-allowlisted telephone
number. Do not overlap it with database, GPU, or media soak runs whose resource
measurements must remain uncontaminated.

Production PostgreSQL resilience is a third independent gate. It binds the
capacity result to cross-host automatic failover and off-host WAL restore evidence:

```bash
npm run check:postgres-production-resilience -- \
  --topology infra/platform-ha/topology.json \
  --capacity outputs/platform-capacity/latest.json \
  --file outputs/postgres-resilience/latest.json \
  --json
```
