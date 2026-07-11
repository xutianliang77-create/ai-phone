# Call Link LiveKit Worker 联调手册

版本：v1.0  
日期：2026-07-03

## 目标

验证国内版 Call Link 的真实三端通话前置链路：

- API 能创建 Call Link。
- LiveKit host/guest room token 可签发。
- Worker 只能通过内部接口拿 token，且必须能订阅用户音频并发布翻译 TTS 音轨。
- Translation Worker 机器可加载 `@livekit/rtc-node`。
- API 能向 LiveKit data topic 发布 smoke 字幕，并写入历史记录。
- host、guest、worker 三个真实 participant 能进入同一 LiveKit 房间。
- host 到 guest 的 data channel 能收到数据。
- guest 发布音频轨后，worker 能订阅并读取 PCM 音频帧。
- worker 发布 `translation-tts-{host|guest}-{sampleRate}` 译音轨后，目标角色能订阅并读取 PCM 音频帧。

## 前置配置

如果选择自建 LiveKit，先按 `docs/poc/livekit-selfhost-runbook.md`
生成并部署 `infra/livekit-selfhost/generated/`，再把
`release.env.snippet` 合入国内版私有发布 env。

API Server 需要真实 LiveKit 配置：

```bash
export API_BASE_URL=http://127.0.0.1:3000
export API_PORT=3000
export PUBLIC_CALL_BASE_URL=http://127.0.0.1:3000
export CALL_ROOM_PROVIDER=livekit
export LIVEKIT_URL=wss://your-livekit-host
export LIVEKIT_API_KEY=your-livekit-api-key
export LIVEKIT_API_SECRET=your-livekit-api-secret
export INTERNAL_API_SECRET=replace-with-internal-secret
export DIAGNOSTICS_ADMIN_TOKEN=replace-with-admin-token
```

Translation Worker 最少需要：

```bash
export MODEL_ROUTING_PROFILE=domestic_server_qwen3_hymt2_voxcpm2
export TRANSLATION_WORKER_CALL_ID=<callId>
export API_BASE_URL=http://<mac-or-api-host>:3000
export INTERNAL_API_SECRET=replace-with-internal-secret
```

`domestic_server_qwen3_hymt2_voxcpm2` 会给 Worker 注入 Qwen3-ASR、Hy-MT2 和
VoxCPM2 的默认本机地址，适合 Worker 与模型服务都运行在 Beelink 的联调拓扑。
如果临时在 Mac 上跑 Worker，再覆盖三个模型 endpoint：

```bash
export ASR_HTTP_ENDPOINT=http://100.110.127.117:8001/asr/transcribe
export ASR_HTTP_FLUSH_ENDPOINT=http://100.110.127.117:8001/asr/sessions/:sessionId/flush
export TRANSLATION_BASE_URL=http://100.110.127.117:8003/v1
export TTS_HTTP_ENDPOINT=http://100.110.127.117:8002/tts/synthesize
```

Beelink VoxCPM2 TTS 如开启鉴权，从远端服务 env 读取 API key：

```bash
export TTS_HTTP_API_KEY=$(ssh beelink@100.110.127.117 "awk -F= '/^TTS_SERVICE_API_KEY=/{print \\$2}' /data/models/translation-model-eval/services/tts-service/.env")
```

## 启动 API

```bash
npm run dev -w @translation/api-server
```

检查：

```bash
curl "$API_BASE_URL/health"
```

`callRoomReadiness.status` 应为 `ready`。

## 跑 Worker 前置验收

```bash
npm run check:call-link-livekit-worker -- \
  --api-base-url "$API_BASE_URL" \
  --internal-api-secret "$INTERNAL_API_SECRET" \
  --diagnostics-admin-token "$DIAGNOSTICS_ADMIN_TOKEN" \
  --json
```

通过标准：

- `status=ready`
- `api_call_room_readiness=pass`
- `host_guest_room_tokens=pass`
- `public_worker_token_rejected=pass`
- `worker_token_permissions=pass`
- `livekit_rtc_node_runtime=pass`
- `smoke_caption_history=pass`

输出会保存到：

```text
.cache/call-link-livekit-worker-readiness.json
```

## 跑真实媒体验收

`@livekit/rtc-node` 建议在实际 Worker 运行环境执行。当前内测拓扑是
Beelink 运行 LiveKit 和 Worker，Mac 只运行 API/Gateway，因此 media readiness
应从 Beelink 发起。

先把脚本同步到 Beelink Worker 目录：

```bash
ssh beelink@100.110.127.117 "mkdir -p /home/beelink/translation-app-worker/scripts/lib"
rsync -az scripts/lib/livekit_room_media_readiness.mjs \
  beelink@100.110.127.117:/home/beelink/translation-app-worker/scripts/lib/
rsync -az scripts/lib/livekit_room_media_probe.mjs \
  beelink@100.110.127.117:/home/beelink/translation-app-worker/scripts/lib/
rsync -az scripts/check_livekit_room_media_readiness.mjs \
  beelink@100.110.127.117:/home/beelink/translation-app-worker/scripts/
```

Mac 启动 API 时，给 Beelink 使用的 room token 写入 Beelink 本机 LiveKit URL：

```bash
export CALL_ROOM_PROVIDER=livekit
export LIVEKIT_URL=ws://127.0.0.1:7880
export INTERNAL_API_SECRET=local-domestic-internal-secret
npm run dev -w @translation/api-server
```

Beelink 上运行：

```bash
cd /home/beelink/translation-app-worker
API_BASE_URL=http://<mac-tailscale-ip>:3000 \
INTERNAL_API_SECRET=local-domestic-internal-secret \
node scripts/check_livekit_room_media_readiness.mjs --json
```

通过标准：

- `participants_joined_room=pass`
- `data_channel_received=pass`
- `worker_audio_subscribed=pass`
- `guest_translation_tts_audio_subscribed=pass`

## 三端真媒体联调

1. App 主持人在通话页创建 Call Link 并进入房间。
2. Web Guest 用微信内浏览器或桌面浏览器打开 join 链接并授权麦克风。
3. 用前置验收输出的 `callId` 或 App 当前创建的 `callId` 启动 Worker：

```bash
MODEL_ROUTING_PROFILE=domestic_server_qwen3_hymt2_voxcpm2 \
TRANSLATION_WORKER_CALL_ID=<callId> \
API_BASE_URL="$API_BASE_URL" \
INTERNAL_API_SECRET="$INTERNAL_API_SECRET" \
npm run dev:call-link-worker
```

4. 如需验证译音播放，设置 `TTS_AUDIO_SINK_ENDPOINT` 指向 LiveKit/PSTN 播放服务；PSTN Bridge 场景可指向 `http://127.0.0.1:3302/translated-audio`。Worker 会把 PCM16 译音、目标听者角色和 segmentId 发送到该 sink。
5. 双方各说中英文短句，观察 App/Web 字幕区。
6. 配置音频 sink 时，确认对方能听到译文 TTS，或 sink 日志收到 `targetSpeakerRole` 和 `audio.data`。
7. App 点击“结束并保存”。
8. 查询历史：

```bash
curl "$API_BASE_URL/sessions/<callId>"
```

## PSTN 来音 Worker 验收

PSTN Bridge 转换后的 `pcm16/16000` 电话帧可直接打到 Translation Worker：

```bash
TRANSLATION_WORKER_AUDIO_FRAME_SINK_PORT=3312 \
TRANSLATION_WORKER_AUDIO_FRAME_SINK_API_KEY=local-frame-sink-secret \
npm run dev:pstn-audio-sink
```

自动 smoke：

```bash
npm run check:translation-worker-pstn-audio-sink -- --json
```

通过标准：

- `pstn_audio_frame_accepted=pass`
- `pstn_audio_reached_asr=pass`
- `pstn_audio_translation_called=pass`
- `pstn_audio_events_published=pass`
- `pstn_audio_tts_playback_sent=pass`

通过标准：

- App 和 Web Guest 都能入房。
- Worker 日志出现 `Translation Worker joined call room.`
- 历史详情有双方原文和译文 segment。
- 配置 `TTS_AUDIO_SINK_ENDPOINT` 后，sink 收到译音 PCM16 载荷；播放失败时字幕仍继续显示。
- 重复结束不会重复扣费。

## 常见失败

| 现象 | 处理 |
| --- | --- |
| `callRoomReadiness` 不是 ready | 检查 `CALL_ROOM_PROVIDER`、`LIVEKIT_URL`、`LIVEKIT_API_KEY`、`LIVEKIT_API_SECRET` |
| worker token 401 | 检查 API 和脚本的 `INTERNAL_API_SECRET` 是否一致 |
| smoke caption 401/503 | 检查 `DIAGNOSTICS_ADMIN_TOKEN` 和 LiveKit 服务端凭证 |
| `livekit_rtc_node_runtime` fail | 运行 `npm install -w @translation/translation-worker` |
| Mac 上 media readiness `signal connection timed out` | 在 Beelink/Linux Worker 环境运行 `check_livekit_room_media_readiness.mjs` |
| App/Web 能入房但无字幕 | 先跑 smoke caption，再检查 Worker ASR/翻译 Provider 日志 |
