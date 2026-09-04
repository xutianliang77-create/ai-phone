# 无界 AI Server Unit

无界 AI 的应用运行单元只有一个容器：`wujie-ai`。API、realtime gateway、
Translation/Voice Agent、Air780 Gateway 和 SRT bridge 都是这个容器内的受控
进程，不按功能拆成容器。容器通过 host network 暴露各自端口；App 只连接 API
和 realtime 入口。LiveKit、PostgreSQL、ASR/TTS/LLM 等是外部基础设施，不属于
无界 AI 应用容器。

容器健康检查始终要求 API、realtime gateway 和默认启用的 Translation Agent
已连接；Translation Agent 还必须完成真实 TTS/LLM 预热并写入本容器内的 readiness
文件。启用 Voice Agent 或 SRT 时对应进程也必须健康；当
`WUJIE_AI_AIR_DEVICE_GATEWAY_ENABLED=true` 时，容器检查 Air Gateway 的
`/healthz`，要求进程和持久 outbox/inbox 健康。物理 Air780 的串口、HELLO、
HEARTBEAT 和 boot admission 由独立 `/readyz` 表示；未准入时拨号与媒体仍然
fail-closed，但不会把可热插拔外设的暂时缺席升级成整个无界 AI 应用容器故障。
这也保证 USB 拔插恢复由 Gateway 子进程处理，不要求重启 API、Realtime、Agent
或整个容器。两个状态都不会让 Docker 自动拨号、重刷设备或释放电话媒体。

`WUJIE_AI_*_ENABLED` 只控制容器内是否启动对应进程，不会创建额外容器。
AI 代打队列调度器同样运行在该容器内；启用
`WUJIE_AI_AGENT_CALL_WORKER_ENABLED=true`（或兼容的
`AGENT_CALL_WORKER_ENABLED=true`）即可启动，不会新增容器。

## Voice Work、可靠播报与 Qwen shadow

后台 Voice Work、客户端 ownership、可靠播报和 Qwen Audio Realtime shadow 的源码已经
接入，但在统一测试、migration 演练和现场验收前保持关闭：

```dotenv
VOICE_AGENT_BACKGROUND_WORK_ENABLED=false
VOICE_AGENT_WORK_RUNNER_ENABLED=false
VOICE_AGENT_OWNERSHIP_ENABLED=false
VOICE_AGENT_DELIVERY_COORDINATOR_ENABLED=false
VOICE_AGENT_AUDIO_REALTIME_SHADOW_ENABLED=false
```

Work runner 与 Delivery Coordinator 都运行在现有 API 进程内；Qwen shadow 运行在现有
Voice Agent 子进程内，不创建新的无界 AI 容器。`AGENT_WORK_TOOL_GATEWAY_URL` 仅指向一个由
部署方明确管理、实现 `workId` 幂等的外部工具接口，本仓库不会为它自动创建容器。当前策略
只注册 `availability_lookup v1` 只读工具；未注册的工具以及外部写副作用全部 fail closed。
App 的 permission resolve 会携带当前 ownership lease/generation；服务端在同一数据库事务内
锁定并复核所有权后才写入决定，接管后的旧客户端不能继续授权。

启用 runner 时必须同时配置 PostgreSQL primary、Work payload key、至少 16 字节的 Tool
Gateway secret，并保证 claim lease 比 gateway timeout 至少长 5 秒。启用 Delivery
Coordinator 时必须同时启用 background work 与 ownership。API 会在监听端口前校验这些依赖；
配置不完整时直接拒绝启动。Qwen shadow 还要求不含凭据/query/fragment 的 `wss://` endpoint
和单独 API key；它只做 text-only 观察，不能调用工具、生成产品回复或向 SIP/Air780/App
发布音频。所有密钥只能留在私有 `server.env`，不得进入镜像或仓库。

上述能力已通过源码自动化，但本次 WIP 拆分本身不等于当前提交已迁移、已部署或可灰度。
所有新 flag 继续默认关闭；启用前必须从干净提交重跑 PostgreSQL、单容器和既有 AI 代打、
翻译、SIP、Air780 回归，再按 background work → ownership → delivery → shadow 的顺序逐层开启。

Translation Agent、Air780 Gateway、Voice Agent、AI 代打队列和 SRT bridge
属于可原地恢复的非关键进程；异常退出后由同一容器内的 supervisor 按有界指数
退避重启，不会重启 API、realtime 或整个 `wujie-ai` 容器。拨号入口仍会在 Worker
没有真正就绪时 fail closed，不会因容器继续存活而绕过媒体准入。退避由
`WUJIE_AI_CHILD_RESTART_INITIAL_MS`、`WUJIE_AI_CHILD_RESTART_MAX_MS` 和
`WUJIE_AI_CHILD_STABLE_UPTIME_MS` 控制。Air780 USB 重新枚举后 Gateway 使用
稳定 by-id 路径恢复串口；若 carrier 仍在通话，则只恢复同一 session/lease/
fence/generation 的 LiveKit 媒体，不重新下发 DIAL。

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

The candidate also requires a dedicated application and compute resource
domain. `WUJIE_RESOURCE_ISOLATION_MODE=dedicated_host`, an isolated
`WUJIE_RESOURCE_DOMAIN`, and `WUJIE_DEDICATED_MODEL_HOSTS` are mandatory. Every
model endpoint in both the private env and the selected model-routing profile
must resolve to that allowlist. Before any remote write, deployment fails if the
target has a running Maruko container, process root, or protected listener. It
never stops Maruko automatically. A single non-MIG GPU cannot provide zero
contention to both products concurrently, so the existing shared Beelink is not
a valid simultaneous target; use a separate compute host/GPU.

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
