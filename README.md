# ai phone

Cross-platform AI translation and calling application for iOS and Android.

## Repository layout

- `apps/mobile`: Flutter mobile application.
- `services/api-server`: account, session, history, usage, and review APIs.
- `services/realtime-gateway`: realtime audio, ASR, translation, and TTS routing.
- `services/translation-worker`: LiveKit and call translation worker.
- `services/model-services`: Python ASR, translation, and TTS services.
- `packages`: shared TypeScript contracts and provider abstractions.
- `infra`: server deployment templates.
- `docs`: product, architecture, development, and acceptance documents.

## Restore a development checkout

```bash
npm ci
cd apps/mobile
flutter pub get
```

Copy the required `.env.example` files to local `.env` files and provide your
own secrets. Model weights, runtime databases, voice recordings, generated
audio, build products, and signing keys are intentionally excluded from Git.

## Enterprise PostgreSQL runtime

The enterprise API uses one repository driver for the whole process. PostgreSQL
cannot be selected unless the startup schema gate succeeds; there is no
fallback or dual-write mode.

```bash
ENTERPRISE_POSTGRES_STARTUP_MODE=verify \
ENTERPRISE_REPOSITORY_DRIVER=postgres \
ENTERPRISE_DATABASE_URL=postgresql://... \
npm run dev:api
```

The independent cell worker requires the same verified schema plus explicit
cell/worker identity and a real HTTPS outbox publisher. Tenant lifecycle
execution must use the configured HTTPS executor, or a non-production local
directory; missing external configuration is reported as failure/retry.

```bash
ENTERPRISE_POSTGRES_STARTUP_MODE=verify \
ENTERPRISE_REPOSITORY_DRIVER=postgres \
ENTERPRISE_DATABASE_URL=postgresql://... \
ENTERPRISE_WORKER_CELL_ID=cell-cn-1 \
ENTERPRISE_WORKER_ID=worker-1 \
ENTERPRISE_OUTBOX_PUBLISHER_URL=https://publisher.example/internal/events \
ENTERPRISE_OUTBOX_PUBLISHER_TOKEN=... \
npm run dev:enterprise-worker
```

JSON/SQLite import is a maintenance-only internal demo migration. Stop API and
workers, use a separate audited maintenance database role capable of reading
forced-RLS tables, and import only into an empty target:

```bash
ENTERPRISE_POSTGRES_DATA_MAINTENANCE=true \
ENTERPRISE_DATABASE_URL=postgresql://... \
npm run enterprise:postgres-data -- import sqlite /absolute/source.sqlite

ENTERPRISE_POSTGRES_DATA_MAINTENANCE=true \
ENTERPRISE_DATABASE_URL=postgresql://... \
npm run enterprise:postgres-data -- reconcile sqlite /absolute/source.sqlite
```

`json` is accepted in place of `sqlite`. Import reads back all current
Tenant/Member/Job/Audit/Inbox/Outbox records in the same transaction and
rolls back unless every collection count/SHA-256 and the total hash match.
SQLite is still `demo_only`; these commands do not prove the real PostgreSQL,
PITR, capacity, security, or enterprise production gates.

## Enterprise marketing outcomes

Migration `0048` upgrades the tenant-scoped `marketing_outcomes` truth and adds
append-only `marketing_next_actions`. Outcomes can only be created for terminal
calls from revision-bound server evidence; each task has one immutable outcome
and at most one internal action whose status is `requested`.

The outcome API does not call CRM, calendar, messaging, or PSTN providers.
`requested` never means an external action completed. External adapter outbox,
retry, and receipt handling remain part of `ENT-MKT-013`. PostgreSQL/RLS, real
calls, providers, and browser acceptance have not yet been executed.

## iOS device build

Standalone device testing must use Profile or Release. Debug builds should only
run while attached to Flutter tooling or Xcode.

```bash
DEVICE_ID=<iphone-device-id> \
SERVER_BASE_URL=https://your-server.example.com \
scripts/install_ios_profile_test.sh
```

The installer checks server health and rejects Debug Flutter artifacts before
installing the App.

## Architecture

The target runtime contains two deployment nodes only: the mobile App and one
server deployment. See
[`docs/ai-phone-two-tier-deployment-data-flow-design.md`](docs/ai-phone-two-tier-deployment-data-flow-design.md).
