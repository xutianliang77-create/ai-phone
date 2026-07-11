# AI 翻译电话协议设计

版本：v0.2
日期：2026-07-02  
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
  | "tts.started"
  | "tts.ended"
  | "highlight.created"
  | "usage.tick"
  | "error";
```

字幕事件：

```json
{
  "type": "translation.final",
  "callId": "call_456",
  "segmentId": "seg_001",
  "speaker": "callee",
  "sourceLanguage": "en",
  "targetLanguage": "zh",
  "sourceText": "Can you spell your name?",
  "translatedText": "你能拼一下你的名字吗？",
  "timestampMs": 1751472000123
}
```

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
  segmentId: string;
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
  providerCallId?: string;
  mediaStreamId?: string;
  segmentId: string;
  targetSpeakerRole: "host" | "guest";
  language: "zh" | "en";
  telephonyAudio: PstnTranslatedAudioUpstreamRequest["telephonyAudio"];
}
```

LiveKit 播放服务用 `targetSpeakerRole` 发布给房间另一侧；PSTN Bridge 会记住 `/agent-calls` 返回的 `providerCallId/mediaStreamId`，并在配置 `PSTN_BRIDGE_MEDIA_WRITER_ENDPOINT` 后把 `telephonyAudio` 写回对应电话媒体流。

## 6. Token

Realtime token 可包含：

```json
{
  "speakerAttribution": {
    "mode": "auto",
    "maxSpeakers": 2,
    "allowVoiceIdentity": false
  }
}
```

Call Link/PSTN 强制 `participant_track`；普通在线对话的 `auto` 可路由到流式 diarization；端侧无模型时降级为 `language_role` 或 `unknown`。

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
