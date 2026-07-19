# LiveKit Self-host Runtime

This directory holds the repo-controlled bootstrap for the domestic Call Link
LiveKit deployment. It does not contain production secrets.

## What This Provides

- A private `.env` contract for the self-hosted LiveKit room provider.
- A renderer that creates `livekit.yaml`, `sip.yaml`, optional `egress.yaml` and
  `ingress.yaml`, `docker-compose.yaml`, `Caddyfile`, `redis.conf`, and a
  release env snippet.
- Inbound SIP remains disabled unless a dedicated trunk, E.164 display number,
  and API-side single-active/PIN dispatch policy are all configured. A shared
  trunk is intentionally rejected.
- A readiness check that blocks placeholder domains, weak secrets, invalid
  ports, and missing TURN domain settings.

## Why Self-host LiveKit

The app, web guest page, API server, and Translation Worker already speak the
LiveKit room/token model. Self-hosting keeps the media room in our own domestic
infrastructure while preserving the existing Flutter/Web/Worker integration.

```text
App / Web Guest
  -> API creates call link and LiveKit room token
  -> self-hosted LiveKit room carries microphone media and data events
  -> Translation Worker subscribes audio, runs ASR/translation/TTS
  -> LiveKit SIP joins a whitelisted PSTN destination as a room participant
  -> API reconciles signed LiveKit webhooks and settles usage
  -> API persists captions, translation, and history
```

## Setup

1. Prepare a Linux VM with a public IP, Docker, and firewall access.
2. Point DNS records at the VM:
   - `LIVEKIT_DOMAIN`, for example `livekit.qkxy.cn`
   - `LIVEKIT_TURN_DOMAIN`, for example `turn-livekit.qkxy.cn`
3. Open these ports on the cloud firewall and host firewall:
   - `80/tcp`, `443/tcp`
   - `7881/tcp`
   - `3478/udp`
   - `5060/udp`
   - `10000-20000/udp`
   - `50000-60000/udp`
   - Egress health and Prometheus ports stay host-local; do not expose them.
4. Create the private env file:

```bash
cp infra/livekit-selfhost/.env.example infra/livekit-selfhost/.env
$EDITOR infra/livekit-selfhost/.env
chmod 600 infra/livekit-selfhost/.env
```

5. Check and render:

```bash
npm run check:livekit-selfhost-config -- \
  --env infra/livekit-selfhost/.env \
  --json

npm run render:livekit-selfhost -- \
  --env infra/livekit-selfhost/.env \
  --output infra/livekit-selfhost/generated \
  --json
```

Enabled container images must use both an explicit tag and an
`@sha256:<digest>` suffix. `latest` and tag-only images fail readiness. The
candidate LiveKit Server tag is recorded in
`infra/livekit-compatibility-profile.json`; it remains release-blocked until
the target-architecture digest and staging media smoke are recorded.

The renderer rejects a private env file readable by group/other users and
writes the generated directory as `0700` with every rendered file at `0600`.
Rendered YAML and the release snippet contain secrets even though Compose mounts
them read-only. Production must materialize the input from an audited external
Secret Manager into a private runtime directory; see
`docs/operations/secret-image-lifecycle.md`.

6. Copy the rendered `generated/` directory to the VM, for example
   `/opt/livekit`, then start it:

```bash
cd /opt/livekit
docker compose up -d
docker compose ps
docker compose logs -f livekit sip egress caddy
```

7. Copy `generated/release.env.snippet` into the private
   `release/domestic/release.env` and rerun the domestic release checks.

Do not make a real call during bootstrap. Create the outbound trunk only in
isolated staging, restrict it to the approved test-number whitelist, and run
the single-dial and webhook-replay gates before the first call.

Egress is rendered only when `LIVEKIT_EGRESS_ENABLED=true`. It shares the
LiveKit Redis RPC plane, writes through the reviewed S3-compatible bucket,
enforces a file-duration limit, and exposes local health/metrics ports. Keep it
disabled until the Egress image tag and target-architecture digest are probed
after the server is available. The bucket must enforce default encryption that
matches `LIVEKIT_EGRESS_S3_SSE`; the API streams completed audio to compute its
SHA-256, writes a JSON manifest, and deletes both objects after retention.
Keep `LIVEKIT_EGRESS_ARTIFACT_WORKER_ENABLED=true` until every retained object
is deleted, even when creation of new recordings is disabled.

Ingress is also disabled by default. When enabled, RTMP/WHIP ports must be
opened only for the approved enterprise sources, pull URLs must match the API
allowlist and pass pinned DNS/redirect preflight. URL Input remains disabled
unless an independent outbound policy blocks every private and reserved range
for the LiveKit Ingress process; an API-side DNS check alone is insufficient.
Ingress runs in a capacity pool separate from Translation
and Agent workers. Connection URLs and stream keys are returned once and are
not persisted by the API.

## Production Note

This bootstrap covers the baseline self-host room path: HTTPS/WSS signaling via
Caddy, LiveKit media over UDP/TCP, Redis, and embedded TURN/UDP. For maximum
connectivity behind strict enterprise firewalls, also run the official LiveKit
VM generator and compare its Caddy/TURN-TLS output before final production
cutover.
