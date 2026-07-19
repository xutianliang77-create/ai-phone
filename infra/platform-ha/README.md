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

Do not enable multi-node writes while SQLite/JSON is the selected primary
store. The PostgreSQL primary runtime and Repository adapters are implemented
and compile-time authorized after isolated staging acceptance, but each target
release must still pass migration, replay, count/hash, verify-full TLS,
single-writer cutover, Patroni/etcd failover, fencing, old-primary rebuild and
WAL-G off-host PITR before multi-node writes are supported.

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

The repository includes the real translation-room runner used by the example
configuration. It authenticates with `PLATFORM_LOAD_ACCOUNT_TOKEN`, alternates
the checked-in Chinese and English PCM fixtures across sessions, waits for the
automatically dispatched Worker, and requires matched ASR, MT, TTS final events
plus target-leg TTS audio. Optional fixture and pacing overrides are
`PLATFORM_LOAD_ZH_AUDIO_FIXTURE`, `PLATFORM_LOAD_EN_AUDIO_FIXTURE`, and
`PLATFORM_LOAD_UTTERANCE_INTERVAL_MS`. Keep credentials in the process
environment; do not write them into the JSON config or evidence files.

The SIP translation runner uses only a deterministic target from
`MIXED_LOAD_PSTN_ALLOWLIST`, never prints the number, and refuses a staging
health profile unless PSTN is ready on `livekit_sip`. It connects the host
before dialing, repeats the identical outbound request to prove the one-dial
idempotency fence, polls that same operation until webhook reconciliation marks
it active, then requires ASR/MT/TTS finals and `playback.ended` for the SIP leg.
The allowlisted destination must be an owned auto-answer test endpoint capable
of the planned parallel call volume; personal or third-party numbers are not
valid capacity targets.

The Agent Egress runner creates an autonomous Agent draft with recording
requested, waits for the bound SIP callee to grant the exact recording policy,
then starts LiveKit Egress twice with the same request to prove the single-start
idempotency fence. It keeps both the Agent call and recording active through the
phase deadline, stops Egress, requires a completed recording plus verified audio
and manifest SHA-256 values, and finally cancels the Agent call. Configure the
private policy bindings only through the process environment:

```bash
export PLATFORM_LOAD_AGENT_CONSENT_PROMPT_VERSION=replace-with-staging-version
export PLATFORM_LOAD_AGENT_DISCLOSURE_PROMPT_VERSION=replace-with-staging-version
export PLATFORM_LOAD_AGENT_RECORDING_POLICY_VERSION=replace-with-staging-version
```

The owned auto-answer endpoint must acknowledge the AI disclosure, explicitly
grant recording consent, and keep the call open until the phase ends. A refusal,
withdrawal, stale generation, early Agent/Egress termination, unverified artifact,
or policy mismatch fails the session; the runner never treats these as success.
Keep `gracefulDrainSeconds` greater than two API request timeouts plus
`PLATFORM_LOAD_EGRESS_ARTIFACT_TIMEOUT_MS`; the example uses 120 seconds so the
artifact recovery worker can finish verification after the phase deadline.

The three failure profiles use the repository failure runner and cannot be
arbitrarily recombined: `translation_worker_sigkill` maps only to
`translation-worker/sigkill`, `model_provider_timeout` to
`model-provider/timeout`, and `livekit_node_drain` to `livekit/node-drain`.
The runner talks only to an allowlisted HTTPS staging controller and submits the
same idempotent request twice. Both requests must resolve to the same operation,
and the second response must be marked as replayed.

The private controller must implement `POST /v1/failure-operations` and
`GET /v1/failure-operations/:operationId`. Every operation is bound to the run,
phase, failure profile, automatic recovery policy, and recovery deadline. A
successful terminal response must include `injectionObservedAt`, `recoveredAt`,
non-empty `injectionEvidence`, and non-empty `recoveryEvidence`. Automatic
recovery is a controller responsibility and must continue if the runner exits or
loses its network connection.
Requests are restricted to `scope=run` and `maxAffectedResources=1`; the
controller must echo and enforce both fields together with target concurrency and
the recovery timeout.

```bash
export PLATFORM_LOAD_FAILURE_CONTROL_ACK=WUJIE_STAGING_FAILURE_ONLY
export PLATFORM_LOAD_FAILURE_CONTROL_URL=https://replace-with-chaos-controller.example.cn/
export PLATFORM_LOAD_FAILURE_ALLOWED_HOSTS=replace-with-chaos-controller.example.cn
export PLATFORM_LOAD_FAILURE_TOKEN=replace-with-private-controller-token
```

Do not point the controller at production or expose a general command-execution
API. The controller implementation must allow only the three bounded profiles,
enforce its own TTL/lease and target allowlists, and return opaque resource IDs
rather than secrets or customer data.

The example system probe queries a staging Prometheus endpoint over HTTPS.
Configure `PLATFORM_LOAD_PROMETHEUS_URL`,
`PLATFORM_LOAD_METRICS_ALLOWED_HOSTS`, and optional
`PLATFORM_LOAD_PROMETHEUS_TOKEN`. The three expressions
`PLATFORM_LOAD_PROMQL_UTILIZATION`, `PLATFORM_LOAD_PROMQL_OOM_COUNT`, and
`PLATFORM_LOAD_PROMQL_UNBOUNDED_QUEUE` must each aggregate the complete staging
pool to exactly one scalar. Ambiguous vectors, utilization outside 0-1,
non-integer OOM counts, and negative queue values fail closed.

```bash
export MIXED_LOAD_STAGING_ACK=WUJIE_STAGING_LOAD_ONLY
export MIXED_LOAD_PSTN_ALLOWLIST=+8613800138000
export PLATFORM_LOAD_ACCOUNT_TOKEN=replace-with-isolated-staging-account-token
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
