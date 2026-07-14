# AI 翻译电话协议设计

版本：v0.6
日期：2026-07-14
关联文档：`docs/ai-phone-translation-technical-design.md`、`docs/ai-phone-translation-data-ops-design.md`

## 1. 状态机

通话状态：

```text
created
reserving_credits
waiting_host
waiting_guest
dialing
ringing
connected
translating
ending
ended
failed
cancelled
```

状态规则：

- `created` 后必须先完成 credits 预检。
- Call Link 进入 `waiting_guest`。
- 拨打手机号进入 `dialing` 和 `ringing`。
- 媒体流接通后进入 `connected`。
- 第一条音频帧进入 AI worker 后进入 `translating`。
- 所有结束路径必须落库为 `ended`、`failed` 或 `cancelled`。

通话腿状态：

```text
created -> joining -> active -> leaving -> ended
                    \-> degraded
```

每个 App、Web、PSTN 媒体流或 Agent 对应一个 `callLegId`。参与者身份、媒体源和目标播放端均以 call leg 为准，不以显示名或文本内容推断。

播放状态：

```text
queued -> streaming -> completed
             |\-> interrupting -> interrupted
             \-> failed
```

同一 `targetLegId` 只有最高 `generation` 可以输出音频。终态不可逆；重复完成、取消和失败事件只能返回已有终态。

## 2. REST API

### 2.1 创建 Call Link

```http
POST /call/rooms
```

请求：

```json
{
  "mode": "call_link",
  "hostLanguage": "zh",
  "guestLanguage": "en",
  "ttsEnabled": true,
  "summaryEnabled": true
}
```

响应：

```json
{
  "callId": "call_123",
  "roomId": "room_123",
  "hostToken": "livekit-token",
  "guestUrl": "https://app.example.com/join/call_123?t=...",
  "expiresAt": "2026-07-02T20:00:00Z"
}
```

### 2.2 拨打手机号

```http
POST /call/phone-calls
```

请求：

```json
{
  "phoneNumber": "+14155550198",
  "hostLanguage": "zh",
  "calleeLanguage": "en",
  "country": "US",
  "provider": "twilio",
  "maxDurationSeconds": 1800
}
```

响应：

```json
{
  "callId": "call_456",
  "roomId": "room_456",
  "hostToken": "livekit-token",
  "reservedCredits": 15,
  "estimatedCreditsPerMinute": 3,
  "status": "dialing"
}
```

### 2.3 结束通话

```http
POST /call/{callId}/end
```

请求：

```json
{
  "reason": "user_ended"
}
```

响应：

```json
{
  "callId": "call_456",
  "status": "ending"
}
```

### 2.4 获取通话详情

```http
GET /call/{callId}
```

响应包含：

- 状态。
- 参与者。
- 时长。
- credits。
- provider call id。
- 摘要状态。
- 历史记录 id。

### 2.5 AI Calling Agent 灰度

```http
POST /ai-calling-agent/drafts
POST /ai-calling-agent/drafts/{draftId}/authorize
POST /ai-calling-agent/drafts/{draftId}/start
POST /ai-calling-agent/drafts/{draftId}/takeover
POST /ai-calling-agent/drafts/{draftId}/cancel
```

`authorize` 必须包含用户确认和告知版本；`start` 在同一账号/草稿事务内再次执行灰度白名单、禁拨、紧急号码和频控检查。重复 Start 返回同一任务；并发 Start 只能有一个请求进入队列和获得 usage hold。

### 2.6 声音克隆与授权声纹

```http
GET    /voice-profiles/me
POST   /voice-profiles/me
POST   /voice-profiles/me/reference-audio
POST   /voice-profiles/me/test-audio
DELETE /voice-profiles/me

GET    /voice-identities
POST   /voice-identities
POST   /voice-identities/{identityId}/reference-audio
POST   /voice-identities/{identityId}/revoke
DELETE /voice-identities/{identityId}
```

参考音频只接受 PCM16 WAV。失败响应可附带 `quality`，包括 `durationMs/sampleRate/channels/rmsDbfs/clippingRatio/silenceRatio/dcOffset/issues`。声纹身份 DTO 不包含 embedding 或存储路径；内部匹配接口只接受内部鉴权，并限定当前 `userId` 的 ready 候选。

### 2.7 移动端 OCR block 协议

Flutter 与 iOS/Android 原生 OCR 通过 `translation_mobile/ocr` MethodChannel 交换以下结构：

```json
{
  "text": "原始全文",
  "provider": "vision_text_recognition",
  "scripts": ["zh", "latin"],
  "blocks": [
    {
      "text": "菜单标题",
      "left": 0.08,
      "top": 0.12,
      "width": 0.42,
      "height": 0.08
    }
  ]
}
```

坐标范围为0到1，原点在图片左上角。App 按 block 顺序翻译并保留源 block；译文层只使用原始坐标回贴。旧 Provider 没有 `blocks` 时，App 使用全文翻译和底部整段叠加，不构造伪坐标。

## 3. WebSocket 事件

所有实时字幕事件使用统一归属对象：

```json
{
  "speaker": {
    "speakerId": "speaker_2",
    "role": "speaker",
    "source": "diarization",
    "displayName": "客户",
    "confidence": 0.91
  },
  "timing": {
    "startMs": 1200,
    "endMs": 2480,
    "source": "client",
    "overlap": false
  }
}
```

`speakerRole` 仅在旧 Call Room payload 中保留一个兼容周期；新服务和 App 以 `speaker` 为权威字段，缺失时才从 `speakerRole` 迁移为 `participant_track`。

迟到归属使用 `speaker.updated`。该事件只更新 UI 和 Repository，不重复翻译、TTS、结算或 LLM 调用。

客户端连接：

```text
wss://api.example.com/call/{callId}/events?token=...
```

事件类型：

```ts
type CallEvent =
  | "call.status"
  | "participant.joined"
  | "participant.left"
  | "audio.level"
  | "transcript.partial"
  | "transcript.final"
  | "translation.partial"
  | "translation.final"
  | "tts.ready"
  | "playback.queued"
  | "playback.started"
  | "playback.interrupted"
  | "playback.ended"
  | "playback.failed"
  | "barge_in.detected"
  | "barge_in.confirmed"
  | "pipeline.degraded"
  | "pipeline.restored"
  | "highlight.created"
  | "usage.tick"
  | "error";
```

所有会改变客户端状态或持久化数据的事件使用统一信封：

```ts
interface CallEventEnvelope {
  type: CallEvent;
  callId: string;
  sessionId: string;
  eventId: string;
  eventSeq: number;
  idempotencyKey: string;
  sourceLegId?: string;
  targetLegId?: string;
  segmentId?: string;
  playbackId?: string;
  generation?: number;
  timestampMs: number;
  payload: Record<string, unknown>;
}
```

`eventSeq` 只保证同一 session 内的持久化事件有序。客户端可按 `eventId` 去重；playback 还必须校验 `targetLegId + generation`，不能让迟到事件恢复旧音频。

字幕事件：

```json
{
  "type": "translation.final",
  "callId": "call_456",
  "sessionId": "call_456",
  "eventId": "evt_001",
  "eventSeq": 42,
  "idempotencyKey": "translation:seg_001:v1",
  "segmentId": "seg_001",
  "sourceLegId": "leg_callee",
  "targetLegId": "leg_host",
  "speaker": "callee",
  "sourceLanguage": "en",
  "targetLanguage": "zh",
  "sourceText": "Can you spell your name?",
  "translatedText": "你能拼一下你的名字吗？",
  "timestampMs": 1751472000123
}
```

播放事件示例：

```json
{
  "type": "playback.interrupted",
  "callId": "call_456",
  "sessionId": "call_456",
  "eventId": "evt_002",
  "eventSeq": 43,
  "idempotencyKey": "playback:pb_001:interrupt:1",
  "sourceLegId": "leg_callee",
  "targetLegId": "leg_host",
  "segmentId": "seg_001",
  "playbackId": "pb_001",
  "generation": 8,
  "timestampMs": 1751472000423,
  "payload": {
    "reason": "barge_in",
    "stopLatencyMs": 241,
    "preRollMs": 400
  }
}
```

`tts.ready` 保留一个兼容周期，只表示音频已生成，不表示已经播放。新客户端以 `playback.*` 为播放状态权威；旧 `tts.started/tts.ended` 不再新增生产者。

全双工控制事件规则：

- `barge_in.detected` 与 `barge_in.confirmed` 必须携带同一 `playbackId + generation + sourceLegId + targetLegId`；后者附带 `stopLatencyMs`、VAD Provider、概率、连续语音时长和 pre-roll。
- `pipeline.degraded` 表示当前 call leg 已回到半双工安全策略，原因只能来自 VAD 不可用、pre-roll 不足、sink 不支持 clear 或 clear 失败等受控枚举；客户端不得继续按全双工保持麦克风常开。
- `pipeline.restored` 只恢复后续播放策略，不恢复、不重放已取消 generation 的 PCM。
- 上述事件不改变 session 终态、不结算用量；重复事件按 eventId/idempotencyKey 去重。

用量事件：

```json
{
  "type": "usage.tick",
  "callId": "call_456",
  "elapsedSeconds": 75,
  "estimatedCreditsUsed": 4,
  "remainingCredits": 96
}
```

## 4. Provider Webhook

统一为内部事件：

```json
{
  "type": "provider.call.status",
  "provider": "twilio",
  "providerCallId": "CAxxxx",
  "callId": "call_456",
  "status": "answered",
  "consumedSeconds": 120,
  "timestamp": "2026-07-02T19:00:00Z"
}
```

必须校验：

- provider 签名。
- callId 映射。
- webhook 幂等。
- 状态合法迁移。

PSTN Bridge 的服务商状态入口为 `POST /provider/status-events`。该入口校验服务商 HMAC 签名，只接受 `eventType=call.status`，把 `answered/connected/in_progress` 归一到 `in_progress`，把 `completed/ended` 归一到 `completed`，把 `failed/busy/no_answer/cancelled` 归一到 `failed`，再使用 `PSTN_BRIDGE_STATUS_WEBHOOK_SECRET` 签名转发到 API 的 `POST /webhooks/pstn/agent-calls`。`completed/failed` 可携带 `consumedSeconds`，API 只在终态结算一次并写入 `agent_call_usage` ledger。重复 `eventId` 在 Bridge 层直接返回 `duplicate`，不重复调用 API。

## 5. PSTN 媒体帧

内部归一化：

```ts
interface MediaFrame {
  callId: string;
  provider: "twilio" | "telnyx";
  providerCallId: string;
  direction: "from_callee" | "to_callee";
  sequence: number;
  timestampMs: number;
  encoding: "mulaw8k" | "pcm16" | "opus";
  payloadBase64: string;
}
```

PSTN Bridge 的电话来音入口为 `POST /media-frames`：

```ts
interface PstnMediaFrameRequest {
  callId: string;
  providerCallId?: string;
  mediaStreamId: string;
  sourceSpeakerRole: "host" | "guest";
  sequence: number;
  timestampMs?: number;
  provider?: string;
  audio: {
    encoding: "mulaw8k";
    sampleRate: 8000;
    durationMs: number;
    data: string;
  };
}
```

Bridge 会转换为内部音频帧 sink 载荷：

```ts
interface PstnAudioFrameSinkRequest {
  callId: string;
  providerCallId?: string;
  mediaStreamId: string;
  sourceSpeakerRole: "host" | "guest";
  sequence: number;
  timestampMs?: number;
  provider?: string;
  audio: {
    format: "pcm16";
    sampleRate: 16000;
    data: string;
  };
}
```

Translation Worker 的 HTTP sink 接收同一载荷，入口为 `POST /pstn/audio-frames`：

```ts
interface TranslationWorkerPstnAudioFrameRequest extends PstnAudioFrameSinkRequest {}

interface TranslationWorkerPstnAudioFrameResult {
  status: "accepted" | "dropped";
  acceptedFrameId?: string;
}
```

控制端点：

```http
POST /pstn/audio-frames/flush
POST /pstn/audio-frames/end
```

`flush` 请求：

```ts
interface TranslationWorkerPstnAudioFlushRequest {
  callId: string;
  sourceSpeakerRole?: "host" | "guest";
}
```

`end` 请求：

```ts
interface TranslationWorkerPstnAudioEndRequest {
  callId: string;
}
```

Bridge 负责：

- provider 消息解析。
- 编码转 PCM16。
- sequence 检查。
- 丢包统计。
- 把 TTS 音频转换成 provider 需要的格式。

Translation Worker 负责：

- 按 `callId + sourceSpeakerRole + sequence` 去重。
- 首帧自动启动 call 级 ASR session。
- 把 `pcm16/16000` 帧送入 ASR -> 翻译 -> TTS。
- 通过内部事件 API 写入 `transcript.final`、`translation.final` 和 `tts.ready`。
- 通过 `TTS_AUDIO_SINK_ENDPOINT` 把译音推给 LiveKit/PSTN 播放服务。

Translation Worker 通过 `TTS_AUDIO_SINK_ENDPOINT` 推送译音。PSTN Bridge 的接收入口为 `POST /translated-audio`：

```ts
interface TtsAudioSinkRequest {
  callId: string;
  sessionId: string;
  segmentId: string;
  playbackId: string;
  generation: number;
  sourceLegId: string;
  targetLegId: string;
  sourceSpeakerRole: "host" | "guest";
  targetSpeakerRole: "host" | "guest";
  language: "zh" | "en";
  providerCallId?: string;
  mediaStreamId?: string;
  provider?: string;
  model?: string;
  firstAudioMs?: number;
  audioDurationMs?: number;
  audio: {
    format: "pcm16";
    sampleRate: 16000 | 24000;
    data: string;
  };
}
```

PSTN Bridge 转发到上游媒体桥时会附加电话侧编码：

```ts
interface PstnTranslatedAudioUpstreamRequest extends TtsAudioSinkRequest {
  telephonyAudio: {
    encoding: "mulaw8k";
    sampleRate: 8000;
    durationMs: number;
    data: string;
  };
}
```

可选的 PSTN Media Writer 使用同一份电话侧编码写入服务商媒体流：

```ts
interface PstnMediaWriteRequest {
  callId: string;
  sessionId: string;
  providerCallId?: string;
  mediaStreamId?: string;
  segmentId: string;
  playbackId: string;
  generation: number;
  targetLegId: string;
  targetSpeakerRole: "host" | "guest";
  language: "zh" | "en";
  telephonyAudio: PstnTranslatedAudioUpstreamRequest["telephonyAudio"];
}
```

播放 sink 必须实现统一可取消合同：

```ts
interface PlaybackSinkCapabilities {
  bidirectionalMedia: boolean;
  streamingWrite: boolean;
  clearPlayback: boolean;
}

interface PlaybackInterruptRequest {
  callId: string;
  sessionId: string;
  targetLegId: string;
  playbackId: string;
  generation: number;
  reason: "barge_in" | "session_end" | "superseded" | "failure";
  idempotencyKey: string;
}
```

内部控制入口：

```http
GET  /internal/playback-sinks/{provider}/capabilities
POST /internal/calls/{callId}/playbacks/{playbackId}/interrupt
```

`interrupt` 必须停止生成、清空 Worker 待发帧并调用 LiveKit/PSTN 的 stop/clear。Provider 返回不支持 clear 时，Orchestrator 必须把该 call leg 标记为 `half_duplex`，不能仅在 UI 上伪装成已中断。

LiveKit 播放服务用 `targetSpeakerRole` 发布给房间另一侧；PSTN Bridge 会记住 `/agent-calls` 返回的 `providerCallId/mediaStreamId`，并在配置 `PSTN_BRIDGE_MEDIA_WRITER_ENDPOINT` 后把 `telephonyAudio` 写回对应电话媒体流。

## 6. Token

Realtime token 可包含：

```json
{
  "speakerAttribution": {
    "mode": "auto",
    "maxSpeakers": 4,
    "allowVoiceIdentity": false
  }
}
```

Call Link/PSTN 强制 `participant_track`，按真实音轨参与者处理且不设置 diarization 人数上限；普通在线对话和聆听的 `auto` 默认使用模型容量 `maxSpeakers=4`；端侧无模型时降级为 `language_role` 或 `unknown`。

服务器内部 ASR turn 边界接口：

```ts
POST /asr/sessions/:sessionId/boundary
{
  boundaryMs: number;
  sourceLanguage: LanguageCode;
  targetLanguage: TranslationLanguageCode;
  hotwords: string[];
  corrections: AsrCorrectionTerm[];
}
```

接口只接受 `SpeechTurnCoordinator` 已确认的边界。成功时返回边界前 transcript，边界后 PCM 留在原 session；没有可提交语音时返回 `204`。该接口为服务器内部能力，不暴露给 App。

会话管理接口：

- `GET /sessions/:sessionId/speakers`：返回 speaker 清单、片段数和累计时长。
- `PATCH /sessions/:sessionId/speakers/:speakerId`：修改本次会话展示名。
- 声音身份注册/撤回接口在完成独立同意、加密存储与删除审计前不得开放。

- LiveKit/WebRTC token 有效期 30-60 分钟。
- Guest token 只能加入指定 call room。
- Event WebSocket token 只读本 call。
- PSTN webhook 不使用用户 token，必须使用 provider 签名。

## 7. 幂等规则

- `POST /call/{id}/end` 可重复调用。
- provider 媒体和状态 webhook 在 Bridge 层按 `eventId` 去重；状态 webhook 到 API 后再次按 `eventId` 去重。
- usage tick 可重复写，但 settle 只能执行一次。
- provider_call_id 和 call_id 必须唯一绑定。
- 所有写命令同时校验 URL call/session id、请求体 id、账号归属和幂等键；不得跨 ID 更新。
- 同一 session 的状态迁移使用事务和 `version` 条件更新；冲突返回当前版本，不进行最后写入覆盖。
- `inbox_events.event_id`、`outbox_events.idempotency_key`、`usage_ledger.idempotency_key` 全局唯一。
- `tts_playbacks` 对 `target_leg_id + generation` 唯一；同一 target leg 最多一个 `queued/streaming/interrupting` 状态。
- 同一 playback 的 `interrupt`、`ended` 和 `failed` 竞争时，以数据库首次终态为准；后续事件返回 duplicate，不重复 clear、TTS 或结算。
- API/Worker 重启后，不重放非终态 playback 音频；统一收敛为 `interrupted(recovery)` 并继续恢复 session 的字幕和结算。
