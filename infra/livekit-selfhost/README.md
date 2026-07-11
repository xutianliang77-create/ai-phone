# LiveKit Self-host Runtime

This directory holds the repo-controlled bootstrap for the domestic Call Link
LiveKit deployment. It does not contain production secrets.

## What This Provides

- A private `.env` contract for the self-hosted LiveKit room provider.
- A renderer that creates `livekit.yaml`, `docker-compose.yaml`, `Caddyfile`,
  `redis.conf`, and a release env snippet.
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
   - `50000-60000/udp`
4. Create the private env file:

```bash
cp infra/livekit-selfhost/.env.example infra/livekit-selfhost/.env
$EDITOR infra/livekit-selfhost/.env
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

6. Copy the rendered `generated/` directory to the VM, for example
   `/opt/livekit`, then start it:

```bash
cd /opt/livekit
docker compose up -d
docker compose ps
docker compose logs -f livekit caddy
```

7. Copy `generated/release.env.snippet` into the private
   `release/domestic/release.env` and rerun the domestic release checks.

## Production Note

This bootstrap covers the baseline self-host room path: HTTPS/WSS signaling via
Caddy, LiveKit media over UDP/TCP, Redis, and embedded TURN/UDP. For maximum
connectivity behind strict enterprise firewalls, also run the official LiveKit
VM generator and compare its Caddy/TURN-TLS output before final production
cutover.
