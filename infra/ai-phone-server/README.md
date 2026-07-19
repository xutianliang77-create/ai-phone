# ai phone Server Unit

This Compose unit runs the API and realtime Gateway on the same Beelink host as
LiveKit and the model services. The App only connects to ports 3110 and 3111.

Runtime state is outside the source tree:

- Environment: `/data/models/ai-phone-server/runtime/server.env`
- API SQLite WAL store: `/data/models/ai-phone-server/runtime/data/api-store.sqlite`
- Legacy JSON migration source: `/data/models/ai-phone-server/runtime/data/api-store.json`
- Voice references: `/data/models/ai-phone-server/runtime/data/voice-references`

Deploy from the repository root:

```bash
MIGRATE_LOCAL_DATA=true scripts/deploy_beelink_app_services.sh deploy
scripts/deploy_beelink_app_services.sh status
```

`MIGRATE_LOCAL_DATA=true` is only for the initial Mac-to-Beelink test data
migration. Later deployments preserve the server-side data volume.

Before the first SQLite deployment, use the guarded deployment switch. The new
API starts with an empty SQLite store, imports the legacy JSON snapshot once,
keeps the JSON file as the rollback source, and runs `quick_check`:

```bash
MIGRATE_SQLITE=true scripts/deploy_beelink_app_services.sh deploy
```

Create a consistent online backup with:

```bash
docker exec ai-phone-api npm run storage:backup -- \
  /data/ai-phone/api-store.sqlite /data/ai-phone/backups/api-store.sqlite
```

Restore requires the API to be stopped and `API_STORAGE_MAINTENANCE=true`.

The generated test environment intentionally keeps the test account enabled.
Before production release, use `NODE_ENV=production`, disable
`API_TEST_AUTO_ACCOUNT`, remove the fixed test code, configure SMS/payment and
rotate all secrets.

## Isolated core production candidate

The production-candidate path is separate from the stable `ai-phone` Compose
project. It accepts only a regular `0600` private env that passes the domestic
release gate with `DOMESTIC_RELEASE_CAPABILITY_PROFILE=core_translation`.
Preflight also rejects stable container names, the stable remote root, reserved
ports, test accounts, debug OTP, and enabled SIP/Agent/Egress switches.

```bash
CANDIDATE_ENV_FILE=release/domestic/release.env \
  npm run check:core-candidate-deploy -- --json

CANDIDATE_ENV_FILE=release/domestic/release.env \
  npm run deploy:beelink-core-candidate

npm run status:beelink-core-candidate
```

Defaults use Compose project/container prefix `ai-phone-core-candidate`, remote
root `/data/models/ai-phone-server-candidates/core-translation`, and ports
`3320/3321/8381`. The deployment never configures Tailscale routing and keeps
its env, SQLite data, image tag, and containers independent from stable. Use
`scripts/deploy_beelink_core_candidate.sh down` to stop the candidate while
retaining its rollback image, previous private env, and isolated data.
