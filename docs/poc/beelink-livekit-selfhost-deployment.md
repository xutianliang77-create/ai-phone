# Beelink LiveKit 自建部署记录

日期：2026-07-04

## 当前主机

- SSH：`beelink@100.110.127.117`
- 局域网 IP：`192.168.2.30`
- 公网出口 IPv4：`222.128.62.139`
- 部署目录：`/home/beelink/livekit-qkxy`
- Docker：已安装并运行
- 现有关键服务：
  - `127.0.0.1:1234` / `100.110.127.117:1234`：LM Studio 相关入口
  - `0.0.0.0:8766`：既有模型网关
  - `0.0.0.0:3000`：open-webui 容器

## 已完成

- 本地生成私有 `infra/livekit-selfhost/.env`。
- `npm run check:livekit-selfhost-config -- --env infra/livekit-selfhost/.env --json`
  已通过。
- `npm run render:livekit-selfhost -- --env infra/livekit-selfhost/.env --output infra/livekit-selfhost/generated --json`
  已生成部署文件。
- 已复制到 Beelink：`/home/beelink/livekit-qkxy`。
- Beelink 上 `docker compose config --quiet` 已通过。
- Beelink 上 LiveKit/Redis 已通过 Docker host network 运行。
- Tailscale 内网 `http://100.110.127.117:7880/` 返回 `OK`，
  `/rtc/validate` 未带 token 返回 401，符合预期。
- Beelink 本机 `@livekit/rtc-node` 最小 participant 入房成功。
- 从 Beelink 执行旧版 `check_livekit_room_media_readiness.mjs`，连接 Mac
  临时 API 和 Beelink LiveKit，已验证 host/guest/worker 入房、data channel
  和 worker 音频订阅均通过。
- 新版 media readiness 已追加 worker 翻译 TTS 音轨回灌检查，并已在
  2026-07-06 从 Beelink 跑通：`callId=29207904-f94b-49c1-bf33-68eeee330c60`，
  `guest_translation_tts_audio_subscribed=pass`。本地证据文件：
  `.cache/beelink-livekit-room-media-readiness-20260706.json`。
- Call Link Worker 前置验收也已在同一临时 LiveKit API 配置下跑通：
  `callId=d9ef9bf5-665b-411c-a3e7-76c3f9923551`，
  `worker_token_permissions=pass`、`smoke_caption_history=pass`。本地证据文件：
  `.cache/call-link-livekit-worker-readiness-20260706.json`。

## 线上仍未完成

当前内测链路走 Tailscale。生产公网链路仍未就绪：

- `livekit.qkxy.cn` 暂无 A 记录。
- `turn-livekit.qkxy.cn` 暂无 A 记录。

当前公网端口也未确认转发：

- `80/tcp`、`443/tcp` 从公网访问超时。
- LiveKit 生产 TLS 需要域名指向 Beelink 公网 IP；裸 IP 不能满足 App/Web 的可信
  WSS/TLS。

## 路由器端口转发

把路由器公网 `222.128.62.139` 转发到 Beelink `192.168.2.30`：

| 外网端口 | 协议 | 内网目标 |
| --- | --- | --- |
| 80 | TCP | `192.168.2.30:80` |
| 443 | TCP | `192.168.2.30:443` |
| 7881 | TCP | `192.168.2.30:7881` |
| 3478 | UDP | `192.168.2.30:3478` |
| 50000-60000 | UDP | `192.168.2.30:50000-60000` |

DNS A 记录：

```text
livekit.qkxy.cn       A 222.128.62.139
turn-livekit.qkxy.cn  A 222.128.62.139
```

## 内测运行状态检查

```bash
ssh beelink@100.110.127.117
cd ~/livekit-qkxy
docker compose ps
curl http://127.0.0.1:7880/
```

Mac 本地 API 临时栈 + Beelink Worker media readiness：

```bash
export CALL_ROOM_PROVIDER=livekit
export LIVEKIT_URL=ws://127.0.0.1:7880
export INTERNAL_API_SECRET=local-domestic-internal-secret
npm run dev -w @translation/api-server
```

```bash
ssh beelink@100.110.127.117
cd /home/beelink/translation-app-worker
API_BASE_URL=http://<mac-tailscale-ip>:3000 \
INTERNAL_API_SECRET=local-domestic-internal-secret \
node scripts/check_livekit_room_media_readiness.mjs --json
```

通过标准必须包含：

- `participants_joined_room=pass`
- `data_channel_received=pass`
- `worker_audio_subscribed=pass`
- `guest_translation_tts_audio_subscribed=pass`

最近一次新版通过记录：

- 时间：2026-07-06 15:28 CST
- API：`http://100.126.244.70:3410`
- LiveKit：Beelink `100.110.127.117:7880`
- `callId=29207904-f94b-49c1-bf33-68eeee330c60`
- 证据：`.cache/beelink-livekit-room-media-readiness-20260706.json`

Call Link Worker 前置验收通过记录：

- 时间：2026-07-06 15:45 CST
- API：`http://100.126.244.70:3410`
- `callId=d9ef9bf5-665b-411c-a3e7-76c3f9923551`
- 通过项：`api_call_room_readiness`、`host_guest_room_tokens`、
  `worker_token_permissions`、`livekit_rtc_node_runtime`、`smoke_caption_history`
- 证据：`.cache/call-link-livekit-worker-readiness-20260706.json`

## DNS 和端口就绪后切公网

```bash
ssh beelink@100.110.127.117
cd ~/livekit-qkxy
docker compose up -d
docker compose ps
docker compose logs -f livekit caddy
```

启动后把 `~/livekit-qkxy/release.env.snippet` 合入私有
`release/domestic/release.env`，再跑：

```bash
npm run check:domestic-release-env -- \
  --file release/domestic/release.env \
  --json

npm run check:call-link-livekit-worker -- \
  --api-base-url "$API_BASE_URL" \
  --internal-api-secret "$INTERNAL_API_SECRET" \
  --diagnostics-admin-token "$DIAGNOSTICS_ADMIN_TOKEN" \
  --json
```
