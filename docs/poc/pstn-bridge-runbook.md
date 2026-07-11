# PSTN Bridge 联调手册

日期：2026-07-03

## 1. 目标

提供可部署的电话服务商桥接服务，承接 Agent Call Worker 的 `POST /agent-calls` 请求，并接收 Translation Worker 的 `POST /translated-audio` 译音回灌请求，把拨号任务和 PCM16 译音转发到真实 PSTN/VoIP 上游。

## 2. 本地启动

```bash
PSTN_BRIDGE_PORT=3302 \
PSTN_BRIDGE_API_KEY=local-bridge-secret \
PSTN_BRIDGE_PROVIDER=mock \
npm run dev:pstn-bridge
```

健康检查：

```bash
curl http://127.0.0.1:3302/health
curl http://127.0.0.1:3302/health/release-ready
```

mock provider 可用于开发联调，但 `/health/release-ready` 必须返回 `not_ready`，不能作为发布配置。

## 3. 真实上游配置

通用 HTTP 服务商适配：

```bash
PSTN_BRIDGE_PORT=3302
PSTN_BRIDGE_API_KEY=replace-with-worker-to-bridge-secret
PSTN_BRIDGE_PROVIDER=http
PSTN_BRIDGE_UPSTREAM_BASE_URL=https://pstn-provider.example.cn
PSTN_BRIDGE_UPSTREAM_API_KEY=replace-with-provider-secret
PSTN_BRIDGE_UPSTREAM_TIMEOUT_MS=10000
PSTN_BRIDGE_MEDIA_WRITER_ENDPOINT=https://pstn-provider.example.cn/media/write
PSTN_BRIDGE_MEDIA_WRITER_API_KEY=replace-with-media-writer-secret
PSTN_BRIDGE_MEDIA_WRITER_TIMEOUT_MS=5000
PSTN_BRIDGE_AUDIO_FRAME_SINK_ENDPOINT=https://worker.example.cn/pstn/audio-frames
PSTN_BRIDGE_AUDIO_FRAME_SINK_API_KEY=replace-with-frame-sink-secret
PSTN_BRIDGE_AUDIO_FRAME_SINK_TIMEOUT_MS=5000
PSTN_BRIDGE_PROVIDER_WEBHOOK_SECRET=replace-with-provider-webhook-secret
PSTN_BRIDGE_PROVIDER_WEBHOOK_MAX_SKEW_MS=300000
PSTN_BRIDGE_STATUS_WEBHOOK_ENDPOINT=https://api.example.cn/webhooks/pstn/agent-calls
PSTN_BRIDGE_STATUS_WEBHOOK_SECRET=replace-with-api-pstn-webhook-secret
PSTN_BRIDGE_STATUS_WEBHOOK_TIMEOUT_MS=5000
PSTN_BRIDGE_STATUS_WEBHOOK_RETRY_COUNT=2
PSTN_BRIDGE_STATUS_WEBHOOK_RETRY_DELAY_MS=250
PSTN_RECORDING_DISCLOSURE_ENABLED=true
```

Fonoster-compatible 适配：

```bash
PSTN_BRIDGE_PORT=3302
PSTN_BRIDGE_API_KEY=replace-with-worker-to-bridge-secret
PSTN_BRIDGE_PROVIDER=fonoster
PSTN_BRIDGE_UPSTREAM_TIMEOUT_MS=10000
PSTN_BRIDGE_FONOSTER_BASE_URL=https://fonoster-facade.example.cn
PSTN_BRIDGE_FONOSTER_ACCESS_KEY_ID=replace-with-access-key-id
PSTN_BRIDGE_FONOSTER_API_KEY=replace-with-api-key
PSTN_BRIDGE_FONOSTER_API_SECRET=replace-with-api-secret
PSTN_BRIDGE_FONOSTER_APP_REF=replace-with-app-ref
PSTN_BRIDGE_FONOSTER_FROM_NUMBER=+8610000000000
PSTN_BRIDGE_FONOSTER_CALL_TIMEOUT_SECONDS=60
PSTN_BRIDGE_MEDIA_WRITER_ENDPOINT=https://fonoster-facade.example.cn/media/write
PSTN_BRIDGE_MEDIA_WRITER_API_KEY=replace-with-media-writer-secret
PSTN_BRIDGE_MEDIA_WRITER_TIMEOUT_MS=5000
PSTN_BRIDGE_AUDIO_FRAME_SINK_ENDPOINT=https://worker.example.cn/pstn/audio-frames
PSTN_BRIDGE_AUDIO_FRAME_SINK_API_KEY=replace-with-frame-sink-secret
PSTN_BRIDGE_AUDIO_FRAME_SINK_TIMEOUT_MS=5000
PSTN_BRIDGE_PROVIDER_WEBHOOK_SECRET=replace-with-provider-webhook-secret
PSTN_BRIDGE_PROVIDER_WEBHOOK_MAX_SKEW_MS=300000
PSTN_BRIDGE_STATUS_WEBHOOK_ENDPOINT=https://api.example.cn/webhooks/pstn/agent-calls
PSTN_BRIDGE_STATUS_WEBHOOK_SECRET=replace-with-api-pstn-webhook-secret
PSTN_BRIDGE_STATUS_WEBHOOK_TIMEOUT_MS=5000
PSTN_BRIDGE_STATUS_WEBHOOK_RETRY_COUNT=2
PSTN_BRIDGE_STATUS_WEBHOOK_RETRY_DELAY_MS=250
PSTN_RECORDING_DISCLOSURE_ENABLED=true
```

`PSTN_BRIDGE_PROVIDER=fonoster` 当前对接的是 Fonoster-compatible HTTP facade：Bridge 会按 Fonoster `createCall` 形态发送 `from/to/appRef/timeout/metadata` 到 `${PSTN_BRIDGE_FONOSTER_BASE_URL}/calls`，并把译音发送到 `${PSTN_BRIDGE_FONOSTER_BASE_URL}/translated-audio`。直接嵌入 Fonoster gRPC SDK、Asterisk AudioSocket 或具体媒体会话管理仍属于下一步真实服务商适配，不在 Bridge 主进程里硬编码。

发布通过标准：

- `PSTN_BRIDGE_PROVIDER=http|fonoster`，不能使用 mock。
- `PSTN_BRIDGE_PROVIDER=http` 时，`PSTN_BRIDGE_UPSTREAM_BASE_URL` 必须是公网 HTTPS，并配置 `PSTN_BRIDGE_UPSTREAM_API_KEY`。
- `PSTN_BRIDGE_PROVIDER=fonoster` 时，`PSTN_BRIDGE_FONOSTER_BASE_URL` 必须是公网 HTTPS，并配置 `PSTN_BRIDGE_FONOSTER_ACCESS_KEY_ID`、`PSTN_BRIDGE_FONOSTER_API_KEY`、`PSTN_BRIDGE_FONOSTER_API_SECRET`、`PSTN_BRIDGE_FONOSTER_APP_REF` 和 `PSTN_BRIDGE_FONOSTER_FROM_NUMBER`。
- `PSTN_BRIDGE_API_KEY` 必须配置。
- `PSTN_BRIDGE_MEDIA_WRITER_ENDPOINT` 必须是公网 HTTPS，并配置 `PSTN_BRIDGE_MEDIA_WRITER_API_KEY`。
- `PSTN_BRIDGE_AUDIO_FRAME_SINK_ENDPOINT` 必须是公网 HTTPS，并配置 `PSTN_BRIDGE_AUDIO_FRAME_SINK_API_KEY`。
- `PSTN_BRIDGE_PROVIDER_WEBHOOK_SECRET` 必须配置，用于服务商媒体回调 HMAC 签名校验。
- `PSTN_BRIDGE_STATUS_WEBHOOK_ENDPOINT` 必须指向 API 的 `POST /webhooks/pstn/agent-calls`，`PSTN_BRIDGE_STATUS_WEBHOOK_SECRET` 必须与 API 的 `PSTN_WEBHOOK_SECRET` 一致。
- `PSTN_BRIDGE_STATUS_WEBHOOK_RETRY_COUNT` 建议为 `2`，Bridge 只对网络错误、HTTP 408/429/5xx 重试，不重试 4xx 配置错误。
- `PSTN_RECORDING_DISCLOSURE_ENABLED=true`。

## 4. Worker 对接

Agent Call Worker 使用以下变量调用本服务：

```bash
PSTN_BRIDGE_BASE_URL=http://127.0.0.1:3302
PSTN_BRIDGE_API_KEY=local-bridge-secret
```

提交体包含：

- `draftId`
- `callId`
- `targetPhone`
- `objective`
- `suggestedScript`
- `language`
- `consentPromptVersion`

返回体至少包含：

- `status=in_progress|completed|failed`
- `providerCallId`
- `failureReason`
- `nextStep`

## 5. 来音接入对接

本地自动验收：

```bash
npm run check:pstn-bridge-media-ingest -- --json
```

该命令会启动真实 `@translation/pstn-bridge` 和本地音频帧 sink，验证 `/media-frames` 的鉴权、非法 payload 拒绝、`mulaw8k` 电话来音接收、转换为 `pcm16/16000`，并把 `callId/mediaStreamId/sourceSpeakerRole` 和 PCM16 音频转发到 `PSTN_BRIDGE_AUDIO_FRAME_SINK_ENDPOINT`。

真实服务商回调入口验收：

```bash
npm run check:pstn-provider-media-event -- --json
```

该命令会验证 `/provider/media-events` 必须带 `x-pstn-provider-timestamp` 和 `x-pstn-provider-signature`，签名内容为 `timestamp.rawBody` 的 HMAC-SHA256；签名通过后，`eventType=media.frame` 的 `mulaw8k/8000` 电话帧会进入同一条 PCM16 sink 链路。重复 `eventId` 会在 Bridge 层返回 `duplicate`，不会重复转发到音频帧 sink。

真实服务商通话状态回调验收：

```bash
npm run check:pstn-provider-status-event -- --json
```

该命令会启动真实 API 和真实 PSTN Bridge，验证 `/provider/status-events` 必须校验服务商 HMAC 签名，只接受 `eventType=call.status`，并把 `answered/completed/failed` 等服务商状态签名转发到 API 的 `POST /webhooks/pstn/agent-calls`，最终更新 AI Calling Agent 草稿状态。`completed/failed` 可携带 `consumedSeconds`，API 会写入 `usageSettledAt` 并只结算一次 `agent_call_usage`。重复 `eventId` 会在 Bridge 层返回 `duplicate`，不会重复调用 API webhook。

服务商媒体适配器向 Bridge 推送电话来音：

```bash
curl -X POST http://127.0.0.1:3302/media-frames \
  -H "authorization: Bearer local-bridge-secret" \
  -H "content-type: application/json" \
  -d '{
    "callId":"call-1",
    "providerCallId":"provider-call-1",
    "mediaStreamId":"stream-1",
    "sourceSpeakerRole":"guest",
    "sequence":1,
    "timestampMs":1751472000123,
    "provider":"domestic_bridge",
    "audio":{"encoding":"mulaw8k","sampleRate":8000,"durationMs":20,"data":"/w=="}
  }'
```

Bridge 转发到音频帧 sink 的载荷为：

- `callId`
- `providerCallId`
- `mediaStreamId`
- `sourceSpeakerRole`
- `sequence`
- `audio.format=pcm16`
- `audio.sampleRate=16000`
- `audio.data`

Translation Worker 已提供对应的本地 sink：

```bash
TRANSLATION_WORKER_AUDIO_FRAME_SINK_PORT=3312 \
TRANSLATION_WORKER_AUDIO_FRAME_SINK_API_KEY=local-frame-sink-secret \
ASR_HTTP_ENDPOINT=http://127.0.0.1:8001/asr/transcribe \
LMSTUDIO_BASE_URL=http://127.0.0.1:1234/v1 \
npm run dev:pstn-audio-sink
```

PSTN Bridge 指向该 Worker：

```bash
PSTN_BRIDGE_AUDIO_FRAME_SINK_ENDPOINT=http://127.0.0.1:3312/pstn/audio-frames
PSTN_BRIDGE_AUDIO_FRAME_SINK_API_KEY=local-frame-sink-secret
```

Worker sink 还提供：

- `POST /pstn/audio-frames/flush`：按 `callId` 和可选 `sourceSpeakerRole` flush ASR。
- `POST /pstn/audio-frames/end`：结束 call，flush 两侧并关闭 ASR session。

本地 Worker 全链路验收：

```bash
npm run check:translation-worker-pstn-audio-sink -- --json
```

该命令会启动真实 Translation Worker PSTN sink，并用本地 mock ASR、翻译、TTS、字幕事件 API 和播放 sink 验证一帧 `pcm16/16000` 电话来音能触发 `transcript.final`、`translation.final`、`tts.ready` 和 TTS 播放请求。

## 6. 译音回灌对接

本地自动验收：

```bash
npm run check:pstn-bridge-audio -- --json
```

该命令会启动真实 `@translation/pstn-bridge` 和本地 HTTP 上游，先通过 `/agent-calls` 创建 `callId -> providerCallId/mediaStreamId` 路由，再验证 `/translated-audio` 的鉴权、非法 payload 拒绝、PCM16 接收、转为 `mulaw8k` 电话载荷、带服务商路由的上游转发，以及配置媒体写入器后 `/media/write` 收到同一段电话音频。

Translation Worker 的音频 sink 可指向本服务：

```bash
TTS_AUDIO_SINK_ENDPOINT=http://127.0.0.1:3302/translated-audio
TTS_AUDIO_SINK_API_KEY=local-bridge-secret
```

Bridge 接收 `pcm16`、`16000|24000` 采样率和 `targetSpeakerRole`，校验 Bearer API key 后，按此前 `/agent-calls` 的 `callId` 路由补充 `providerCallId/mediaStreamId`，再附加 `telephonyAudio={encoding:"mulaw8k",sampleRate:8000,data}` 并转发给上游：

```bash
curl -X POST http://127.0.0.1:3302/translated-audio \
  -H "authorization: Bearer local-bridge-secret" \
  -H "content-type: application/json" \
  -d '{
    "callId":"call-1",
    "segmentId":"seg-1",
    "sourceSpeakerRole":"host",
    "targetSpeakerRole":"guest",
    "language":"en",
    "audio":{"format":"pcm16","sampleRate":16000,"data":"AA=="}
  }'
```

返回体至少包含：

- `status=queued|played|failed`
- `providerPlaybackId`
- `mediaWriteId`
- `failureReason`
- `nextStep`

## 7. 内部媒体闭环验收

在没有真实 PSTN/VoIP 服务商账号前，先跑完整内部链路：

```bash
npm run check:pstn-internal-media-loop -- --json
```

该命令会同时启动真实 PSTN Bridge 和真实 Translation Worker PSTN audio frame sink，再用本地 mock ASR、翻译、TTS、字幕事件 API、PSTN 上游和 media writer 验证：

- Bridge `/agent-calls` 创建 `callId -> providerCallId/mediaStreamId` 路由。
- Bridge `/media-frames` 接收 `mulaw8k/8000` 电话帧并转成 `pcm16/16000`。
- Worker `/pstn/audio-frames` 收到帧后触发 ASR、翻译、TTS 和字幕事件。
- Worker `TTS_AUDIO_SINK_ENDPOINT` 把译音发回 Bridge `/translated-audio`。
- Bridge 给上游和 media writer 写入带 `telephonyAudio={mulaw8k,8000}` 的译音。

国内版总发布门禁默认执行同等 `pstn_internal_media_loop_readiness`；只有局部排查单个外部阻塞项时才使用 `--skip-pstn-internal-media-loop`。

## 8. 后续真实媒体桥

当前 Bridge 已完成控制面、内部来音、服务商签名来音、服务商签名状态回调和译音回灌入口：认证、任务接收、`callId -> providerCallId/mediaStreamId` 路由记忆、8k μ-law 来音转 PCM16、Translation Worker PSTN sink、PCM16 来音驱动 ASR/翻译/TTS、PCM16 译音接收、8k μ-law 译音编码、上游转发、媒体写入器、服务商回调 `eventId` 幂等、状态 webhook 转发和发布门禁。真实发布还需要把具体服务商 websocket/session 协议适配到 `/provider/media-events`、`/provider/status-events` 与 `PSTN_BRIDGE_MEDIA_WRITER_ENDPOINT`。
