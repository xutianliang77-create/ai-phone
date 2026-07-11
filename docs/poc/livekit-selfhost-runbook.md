# LiveKit 自建部署手册

版本：v0.1  
日期：2026-07-04

## 目标

把国内版 Call Link 从“需要真实 LiveKit 配置”推进到“可自建部署、可检查、可接入发布 env”：

- 自建 LiveKit 房间承载 App/Web 麦克风媒体和字幕 data event。
- API Server 继续签发 host/guest/worker room token。
- Translation Worker 继续订阅 LiveKit 音频轨并下发字幕/TTS 状态。
- 私有 `release/domestic/release.env` 使用自建 LiveKit 的 URL/key/secret。

## 翻译模型职责

`tencent/Hy-MT2-1.8B` 是当前国内版服务端翻译主模型，通过
`REALTIME_PROVIDER=hymt2_self_hosted` 和 `TRANSLATION_*` 配置接入
OpenAI-compatible 服务：

- 同传链路：ASR 产出原文后，Gateway 调 Hy-MT2 服务端 Provider 翻译文本。
- 通话链路：Worker 复用同一 Provider 做字幕翻译，再交给 TTS 回灌。
- 发布门禁：`server_translation_smoke` 使用 `TRANSLATION_MODEL=tencent/Hy-MT2-1.8B`
  和 `TRANSLATION_API_KEY` 跑真实翻译 smoke，避免 mock 或实验模型误进发布。

`qwen-plus` 不承担端侧 ASR 或 LiveKit 房间职责，现在保留为商业质量兜底：
复杂上下文、摘要、重点、术语建议和 AI Calling Agent 文本生成可以走 Qwen。

## LiveKit 自建部署

### 1. 准备域名和服务器

准备一台 Linux VM，DNS 指向同一个公网 IP：

- `livekit.qkxy.cn`
- `turn-livekit.qkxy.cn`

开放端口：

- `80/tcp`：Caddy 申请证书。
- `443/tcp`：App/Web 的 `wss://livekit.qkxy.cn`。
- `7881/tcp`：WebRTC TCP。
- `3478/udp`：TURN/UDP。
- `50000-60000/udp`：WebRTC UDP。

### 2. 创建私有配置

```bash
cp infra/livekit-selfhost/.env.example infra/livekit-selfhost/.env
$EDITOR infra/livekit-selfhost/.env
```

至少替换：

```bash
LIVEKIT_DOMAIN=livekit.qkxy.cn
LIVEKIT_TURN_DOMAIN=turn-livekit.qkxy.cn
LIVEKIT_API_KEY=<真实 key>
LIVEKIT_API_SECRET=<至少 32 字符强 secret>
```

### 3. 检查并渲染

```bash
npm run check:livekit-selfhost-config -- \
  --env infra/livekit-selfhost/.env \
  --json

npm run render:livekit-selfhost -- \
  --env infra/livekit-selfhost/.env \
  --output infra/livekit-selfhost/generated \
  --json
```

渲染输出：

- `livekit.yaml`
- `docker-compose.yaml`
- `Caddyfile`
- `redis.conf`
- `release.env.snippet`

### 4. 部署到 VM

```bash
scp -r infra/livekit-selfhost/generated user@<vm-ip>:/opt/livekit
ssh user@<vm-ip>
cd /opt/livekit
docker compose up -d
docker compose ps
docker compose logs -f livekit caddy
```

Caddy 日志里应看到证书申请成功；如果失败，先检查 DNS、80/443 防火墙和云安全组。

### 5. 接入国内版发布 env

把 `generated/release.env.snippet` 合入私有：

```bash
release/domestic/release.env
```

并确认：

```bash
CALL_ROOM_PROVIDER=livekit
LIVEKIT_URL=wss://livekit.qkxy.cn
LIVEKIT_API_KEY=<与 livekit.yaml 一致>
LIVEKIT_API_SECRET=<与 livekit.yaml 一致>
```

### 6. 验收

先跑配置门禁：

```bash
npm run check:domestic-release-env -- \
  --file release/domestic/release.env \
  --json
```

再启动 API 后跑 Call Link Worker 前置验收：

```bash
npm run check:call-link-livekit-worker -- \
  --api-base-url "$API_BASE_URL" \
  --internal-api-secret "$INTERNAL_API_SECRET" \
  --diagnostics-admin-token "$DIAGNOSTICS_ADMIN_TOKEN" \
  --json
```

最后做三端真实媒体：

1. App 创建 Call Link 并入房。
2. Web Guest 打开链接授权麦克风。
3. Translation Worker 用当前 callId 入房订阅。
4. 双方连续说中英文 5 分钟。
5. 验收字幕、TTS ready、历史保存、用量扣减。

## 生产注意

当前仓库渲染器提供基础自建路径。正式生产如果要覆盖更严格的企业防火墙场景，应再运行
LiveKit 官方 VM generator，比对它生成的 Caddy/TURN-TLS 配置，再决定是否打开
`LIVEKIT_ENABLE_TURN_TLS=true` 并配置证书路径。
