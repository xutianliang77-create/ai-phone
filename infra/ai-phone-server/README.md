# 无界 AI Server Unit

无界 AI 的应用运行单元只有一个容器：`wujie-ai`。API、realtime gateway、
Translation/Voice Agent、Air780 Gateway 和 SRT bridge 都是这个容器内的受控
进程，不按功能拆成容器。容器通过 host network 暴露各自端口；App 只连接 API
和 realtime 入口。LiveKit、PostgreSQL、ASR/TTS/LLM 等是外部基础设施，不属于
无界 AI 应用容器。

`WUJIE_AI_*_ENABLED` 只控制容器内是否启动对应进程，不会创建额外容器。
AI 代打队列调度器同样运行在该容器内；启用
`WUJIE_AI_AGENT_CALL_WORKER_ENABLED=true`（或兼容的
`AGENT_CALL_WORKER_ENABLED=true`）即可启动，不会新增容器。

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

After a successful deployment, the image tag is pinned in
`/data/models/ai-phone-server/runtime/ai-phone-image-tag`. For a host reboot or
container restart, use the fast start path:

```bash
REMOTE_HOST=beelink@192.168.1.146 scripts/deploy_beelink_app_services.sh start
```

`start` recovers the pinned image and the currently enabled in-container
processes, then runs `docker compose up -d --no-build`; it does not rsync source,
run `npm ci`, rebuild the image, rewrite secrets, or touch the data volume.
Its default readiness-stability window is 5 seconds (override with
`FAST_START_STABILITY_WINDOW_SECONDS` when the host is recovering from a full
reboot). Use `deploy` only when source or runtime configuration has intentionally
changed.

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
docker exec ai-phone-wujie-ai npm run storage:backup -- \
  /data/ai-phone/api-store.sqlite /data/ai-phone/backups/api-store.sqlite
```

Restore requires the API to be stopped and `API_STORAGE_MAINTENANCE=true`.

The generated test environment intentionally keeps the test account enabled.
The stable deployment script defaults to the test profile so this environment
is not accidentally locked out. Before production release, prepare an
existing `server.env` with `NODE_ENV=production`, PostgreSQL primary storage,
real SMS settings, no fixed test account/code, loopback-only internal binds,
and an explicit `wss://` realtime endpoint, then run with
`AI_PHONE_DEPLOY_PROFILE=production`. The production profile fails closed and
never generates a test env or changes these security settings implicitly.

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
