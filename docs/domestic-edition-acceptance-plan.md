# 国内版验收计划

版本：v4.2  
日期：2026-07-05  
关联：`docs/domestic-edition-development-plan.md`、`docs/domestic-edition-optimization-plan.md`

## 1. 验收目标

验证国内版是否达到内测、灰度、上架准备和商业发布标准。

默认验收配置：

```text
REGION_EDITION=domestic
DATA_REGION=cn
COMPLIANCE_PROFILE=pipl
MOBILE_RELEASE_COMPANY_NAME=北京乾坤祥云科技有限公司
PUBLIC_CALL_BASE_URL=https://call.example.cn
REALTIME_PROVIDER=hymt2_self_hosted
TRANSLATION_PROVIDER=hymt2_self_hosted
TRANSLATION_BASE_URL=https://translation.example.cn/v1
TRANSLATION_MODEL=tencent/Hy-MT2-1.8B
TRANSLATION_API_KEY=required
SESSION_REVIEW_PROVIDER=local|openai_compatible
OCR_PROVIDER=vision|mlkit|tencent|aliyun
CALL_PROVIDER=call_link_only|domestic_pstn_bridge
CALL_ROOM_PROVIDER=livekit
LIVEKIT_URL=required
LIVEKIT_API_KEY=required
LIVEKIT_API_SECRET=required
CALL_ROOM_TOKEN_TTL_SECONDS=120
CALL_GUEST_TICKET_TTL_SECONDS=300
CALL_ROOM_MAX_PARTICIPANTS=3
CALL_ROOM_MAX_SESSION_SECONDS=3600
CALL_ROOM_MAX_DATA_PACKET_BYTES=12288
PAYMENT_PROVIDER=apple|wechat|alipay
PAYMENT_REQUIRED_PROVIDERS=apple_iap,wechat_pay,alipay
PAYMENT_CALLBACK_BASE_URL=https://api.example.cn
RELEASE_MATERIALS_FILE=release/domestic/release-materials.json
MODEL_SELECTION_FILE=release/domestic/model-selection-report.json
MODEL_ROUTING_FILE=release/domestic/model-routing.json
MODEL_ROUTING_PROFILE=domestic_server_qwen3_hymt2_voxcpm2
PSTN_BRIDGE_BASE_URL=https://pstn-bridge.example.cn
TTS_AUDIO_SINK_ENDPOINT=http://pstn-bridge.example.cn/translated-audio
DIAGNOSTICS_ADMIN_TOKEN=required
DIAGNOSTICS_ONCALL_CONTACT=required
DIAGNOSTICS_ALERT_WINDOW_MINUTES=15
DIAGNOSTICS_FATAL_ALERT_THRESHOLD=1
DIAGNOSTICS_ALERT_WEBHOOK_URL=required
DIAGNOSTICS_ALERT_WEBHOOK_SECRET=required
DIAGNOSTICS_ALERT_WEBHOOK_TIMEOUT_MS=5000
DIAGNOSTICS_ALERT_WEBHOOK_FORMAT=generic|wecom|feishu|dingtalk
```

## 2. 放行等级

| 等级       | 必须通过          | 允许未完成                   |
| ---------- | ----------------- | ---------------------------- |
| 内测版     | A0-A4、A10 基础项 | Call Link、支付、PSTN、Agent |
| 灰度版     | A0-A6、A9-A11     | PSTN 和 Agent 可小流量灰度   |
| 上架准备版 | A0-A6、A9-A13     | PSTN 可隐藏，Agent 可灰度    |
| 商业完整版 | A0-A13            | 无核心阻塞项                 |

## 3. A0 工程验收

命令：

```bash
npm run check:lines
npm run typecheck
npm test
npm run build
npm run test:scripts
npm run check:domestic-release-env -- --file release/domestic/release.env --json
cd apps/mobile && flutter --no-version-check test --no-pub
cd apps/mobile && flutter --no-version-check build apk --debug --no-pub
cd apps/mobile && flutter --no-version-check build ios --no-codesign --no-pub
```

中文路径导致 `flutter analyze` 异常时，使用 ASCII 临时副本运行等价验收。

通过标准：

- 自动化测试全部通过。
- 新增业务文件不超过 350 行。
- iOS 和 Android 构建成功。
- 无后台服务、模拟器、Flutter run 残留进程。
- 所有新增功能有测试或验收脚本覆盖。

## 4. A1 国内版配置和中文 UI

用例：

- App 以 `REGION_EDITION=domestic` 启动。
- API 和 Gateway 以 `DATA_REGION=cn` 启动。
- 打开同传、通话、扫描、记录、我的五个 Tab。
- 打开诊断页和隐私与合规中心。

通过标准：

- 页面无英文占位文案，技术错误也有中文解释。
- 国内版不展示 Stripe、Google Play、Twilio/Telnyx 默认入口。
- 首次启动不申请麦克风、相机、相册权限。
- iPhone 小屏、Pro Max、Android 常见尺寸不溢出。

## 5. A2 同传、Listening、Type-to-Speak

设备：

- iPhone 真机。
- Android 真机或模拟器。

语料：

- 中文短句 20 条。
- 英文短句 20 条。
- 中文长句 10 条。
- 中英快速切换 20 轮。
- 外贸/会议/地址/数字/姓名各 10 条。
- 噪声环境 10 条。

通过标准：

- 3 秒内出现识别反馈。
- 常规译文 1-3 秒内出现。
- 端侧 ASR 首次 native start 若出现瞬时失败，App 自动重试一次，不要求用户手动点第二次开始；连续失败时要保留已创建会话并显示中文错误。
- 自动语种识别：中文转英文、英文转中文，不需要手动切方向。
- 说完后 flush 成功，不出现“有原文无译文”的最终记录。
- 中英快速切换不连续漏译。
- 自动语种识别低置信度时有日志或诊断记录，不用目标语言静默反推源语言。
- Android 侧用 `DEVICE_ASR_PROVIDER=android_system` 或 `system` 可走系统 `SpeechRecognizer` ASR 兜底；`npm run check:mobile-app-release-ready -- --json` 必须包含 Android 系统 ASR Provider、原生桥和 `android.speech.RecognitionService` 查询声明检查。
- 字幕超过一屏自动滚动到最新。
- End 后历史有原文、译文、时长和模式。
- Type-to-Speak 可翻译、朗读、保存；产品码、金额、电话号等朗读文本必须可读化，屏幕上的译文不被改写。
- Type-to-Speak 保存后可在历史详情打开；服务端保存接口返回 `ended` 会话且 `consumedSeconds=0`，不得扣减实时同传余额。
- Listening Mode 不默认播放 TTS，并能保存会话。

## 6. A3 国内 Provider 验收

Provider 候选：

- self-hosted：SenseVoice + Qwen/LM Studio。
- Qwen OpenAI-compatible commercial route with QWEN_* config.
- 腾讯 TRTC AI 转写翻译。

用例：

- 普通中英对话。
- 外贸报价。
- 会议安排。
- 物流、报关、产品型号。
- Provider 故障和超时。

通过标准：

- 至少一条国内真实 Provider 端到端通过，Hy-MT2 自托管翻译作为服务端主链路，qwen_live 只作为质量兜底。
- Provider health、Gateway `/health/release-ready` 和 `npm run check:domestic-local-stack` 可见。
- 失败时有降级或明确错误，不静默 mock。
- OpenAI-compatible 翻译 Provider 遇到“需要更多上下文”“请提供文本”“无法翻译”等聊天式非译文时，必须自动重试一次；最终仍失败时不得把拒译内容发布成译文。
- 日志/历史导出记录 provider、model、latency、failure reason、fallback 和 token 估算。
- 国内版不把海外服务作为主链路，缺 TRANSLATION_* / Hy-MT2 配置不能发布。
- 模型替换前运行 `npm run model:evaluate -- --json`，并留存 ASR、翻译、TTS 指标结果。
- 上架准备前运行 `npm run check:model-selection-ready -- --json`，真实模型选型报告必须包含 ASR、翻译、TTS 的默认、灰度和兜底链路。
- 上架准备前运行 `npm run check:model-routing -- --json`，真实模型路由必须覆盖 ASR、翻译、TTS，并能渲染 Gateway/Worker/模型服务 env。
- 当前模型选型状态为 selected；正式报告为 `release/domestic/model-selection-report.json`，缺失或降回 `status=todo` 时，总发布门禁必须保持 `not_ready`。

## 7. A4 记录、摘要、重点、术语、导出

用例：

- Talk Mode、Listening Mode、Type-to-Speak 均可保存。
- `POST /sessions/:sessionId/review` 可生成并持久化复盘。
- 本地复盘 Provider 可兜底生成摘要、重点、术语。
- OpenAI-compatible 复盘 Provider 缺配置时返回 503。
- 历史详情可刷新显示服务端复盘。
- Markdown 导出包含摘要、重点和术语。
- 术语确认、撤销，并进入下一次同传术语提示。
- 复盘失败后全文仍可打开。

通过标准：

- 历史列表可搜索、筛选、删除。
- 历史详情包含摘要、重点、全文、术语。
- 摘要失败不影响全文打开，生成入口有错误提示。
- 术语确认后下一次同传纠错生效。
- 导出可调起系统分享。
- 记录中不保存原始音频。

## 8. A5 扫描 OCR 翻译

素材：

- 菜单 10 张。
- 外贸合同/报价单 10 张。
- 物流/报关单据 10 张。
- 路牌/说明 10 张。

通过标准：

- 拍照、相册、截图导入可用。
- 原文、译文、对照视图可切换。
- OCR 失败有清晰提示。
- 结果可复制、保存、分享。
- 保存后可在历史详情打开；服务端保存接口返回 `ended` 会话且 `consumedSeconds=0`，不得扣减实时同传余额。
- iOS Vision 和 Android ML Kit 至少各完成一轮真机或模拟器验收。

## 9. A6 Call Link 通话房间

设备：

- App 主持人：iPhone 或 Android。
- Guest：微信内浏览器、系统浏览器、桌面浏览器。

用例：

- 创建链接。
- 微信分享。
- App 主持人授权麦克风并进入 LiveKit 房间。
- Guest 授权麦克风。
- 自建 LiveKit 场景先运行 `npm run check:livekit-selfhost-config -- --env infra/livekit-selfhost/.env --json`，确认主域名、TURN 域名、key/secret 和端口配置通过。
- 运行 `npm run check:call-link-livekit-worker` 验证 worker room token、LiveKit runtime、smoke caption、`tts.ready` 和历史写入。
- 在 Beelink/Linux Worker 环境运行 `node scripts/check_livekit_room_media_readiness.mjs --json`，验证 host/guest/worker 三方入房、data channel、用户音频进入 worker，以及 worker 发布的译文 TTS 音轨可被目标角色订阅。
- `INTERNAL_API_SECRET` 缺失或短于 16 字符时，Call Link 内部事件接口、Worker room token、Realtime 内部分段写入、术语库内部读取、AI Agent Worker 状态接口和 API release-ready 必须失败。
- 查询 `/sessions/:sessionId` 验证 smoke 字幕已保存。
- App 主持人点击“结束并保存”，调用 `/call-links/:callId/end`。
- 重复调用结束接口验证不重复扣费。
- 双方 5 分钟通话。
- 中英双向翻译。
- 网络断开和恢复。
- 结束并保存记录。

通过标准：

- Guest 不安装 App 可加入。
- App 主持人端使用 LiveKit SDK 入房并发布麦克风。
- 自建 LiveKit 的 `LIVEKIT_URL`、`LIVEKIT_API_KEY`、`LIVEKIT_API_SECRET` 来自同一份渲染配置，并已合入私有 `release/domestic/release.env`。
- 服务端能下发 smoke/Worker 字幕和 `tts.ready` 事件，预检脚本 `status=ready`，Worker token 必须可订阅用户音频并发布翻译 TTS 音轨，Worker 音频源能把 ASR/翻译/TTS 就绪结果提交到内部事件 API。
- Beelink/Linux Worker media readiness 必须 `status=ready`，且 `participants_joined_room`、`data_channel_received`、`worker_audio_subscribed`、`guest_translation_tts_audio_subscribed` 全部通过；Mac 本机 `@livekit/rtc-node` 若出现信令超时，不作为 Worker 发布环境通过依据。
- App 主持人端能按段显示 LiveKit data 原文、译文字幕和 TTS 就绪状态。
- Web Guest 能按段合并显示 LiveKit data 原文、译文字幕和 TTS 就绪状态。
- 双方字幕区分“我”和“对方”。
- 对方听到翻译后的 TTS 或看到译文字幕。
- Translation Worker 在 LiveKit 房间内能发布 `translation-tts-{host|guest}-{sampleRate}` 译音轨；App/Web 播放逻辑必须只播放目标角色对应的译音轨，避免说话方听到自己的回声。
- Call Link 字幕超过一屏后必须自动滚动到最新字幕段。
- 国内版生产 env 必须配置 `TTS_PROVIDER=voxcpm2`、`TTS_MODEL=VoxCPM2`、公网 HTTPS `TTS_HTTP_ENDPOINT` 和足够强的 `TTS_HTTP_API_KEY`；Worker 若收到不匹配的 TTS provider/model，不得发布错误的 `tts.ready`。
- TTS HTTP 服务必须支持 `GET /health` 和 `POST /tts/synthesize`；生产环境必须配置 `TTS_SERVICE_API_KEY` 并要求 `POST /tts/synthesize` 使用 Bearer 鉴权；生产 `voxcpm2` 模式在 runtime 或模型目录不可用时必须明确 degraded/503，不得返回 mock 或假 VoxCPM2 音频。
- Beelink Tailscale VoxCPM2 TTS endpoint `http://100.110.127.117:8002/tts/synthesize` 已作为内测真实服务通过 smoke；上架准备环境必须替换为公网 HTTPS 或同等审核网络路径，并继续通过同一 `check:tts-provider`。
- `npm run check:tts-provider -- --json` 必须返回 `status=ready`，并证明 VoxCPM2 服务返回 `provider=voxcpm2`、`model=VoxCPM2`、16k/24k PCM16 音频和合格 `firstAudioMs`。
- Translation Worker 的字幕文本和 TTS 播报文本必须分离；SKU、金额、电话号等播报文本可读化后再送 TTS，App/Web 字幕仍显示原译文。
- 配置 `TTS_AUDIO_SINK_ENDPOINT` 时，Translation Worker 能把 PCM16 译音载荷发送到播放服务，播放服务能按 `targetSpeakerRole` 投递给另一侧。
- TTS 服务返回 200 但没有有效 `pcm16` 音频时，不得发布 `tts.ready` 假就绪；Worker 必须保留 `transcript.final` 和 `translation.final`，并发布中文 `worker.status` 提示 TTS 合成失败。
- 网络断开有重连或明确提示。
- 创建链接后 `sessionId=callId`，历史详情可打开。
- smoke caption 产生的 `transcript.final`、`translation.final` 和 `tts.ready` 合并为同一条历史 segment。
- 结束接口把通话 session 标记为 `ended`，记录 `consumedSeconds` 并只扣减一次余额。
- 结束后记录包含 call id、时长、双方全文、译文、摘要。
- PSTN 未开放时，拨号入口隐藏或标记“灰度中”。

## 10. A7 拨打手机号翻译电话

灰度前置条件：

- PSTN/VoIP 测试账号、服务商 webhook、录音/转写/AI 翻译提示、credits 预扣/结算/退款和合规评审都已就绪。

用例：

- 用户输入手机号并确认拨打，对方接听普通电话。
- 用户在 App 内 VoIP 通话，双方各说一种语言。
- 用户余额不足、对方忙线、拒接、超时。
- 服务商 webhook 重放。
- 服务商 completed/failed webhook 签名错误、缺 `eventId` 和重复 `eventId`。
- 服务商 answered/completed/failed 状态回调经 PSTN Bridge 转发到 API。

通过标准：

- 用户不离开 App，对方不安装 App。
- 接通后 3 秒内显示第一条识别反馈。
- 双向翻译链路可用：ASR -> 翻译 -> TTS。
- 服务商来音推送到 PSTN Bridge `POST /media-frames` 时，Bridge 能校验 Bearer API key、接收 `mulaw8k/8000` 电话帧、转换成 `pcm16/16000`，并转发到音频帧 sink。
- `npm run check:pstn-bridge-media-ingest -- --json` 返回 `status=ready`，检查项包含 `media_frame_requires_bridge_key`、`media_frame_rejects_invalid_payload`、`media_frame_accepted` 和 `media_frame_forwarded_to_audio_sink`。
- 服务商状态推送到 PSTN Bridge `POST /provider/status-events` 时，Bridge 能校验 `x-pstn-provider-timestamp` 和 `x-pstn-provider-signature`，只接受 `eventType=call.status`，并签名转发到 API 的 `POST /webhooks/pstn/agent-calls`。
- `npm run check:pstn-provider-media-event -- --json` 返回 `status=ready`，检查项包含 `provider_media_event_requires_signature`、`provider_media_event_rejects_invalid_payload`、`provider_media_event_accepted`、`provider_media_event_deduplicates_event_id` 和 `provider_media_event_forwarded_to_audio_sink`。
- `npm run check:pstn-provider-status-event -- --json` 返回 `status=ready`，检查项包含 `provider_status_event_requires_signature`、`provider_status_event_rejects_invalid_payload`、`provider_status_event_updates_in_progress`、`provider_status_event_deduplicates_event_id` 和 `provider_status_event_updates_completed`，且 completed 事件带 `consumedSeconds` 后 API 写入 `usageSettledAt`。
- API 状态 webhook 出现网络错误、HTTP 408/429/5xx 时可短重试；HTTP 4xx 配置错误不得重试掩盖。
- Translation Worker `POST /pstn/audio-frames` 能校验 Bearer API key、拒绝非法采样率、按 `callId/sourceSpeakerRole/sequence` 去重，并把 `pcm16/16000` 电话帧送入 ASR -> 翻译 -> TTS。
- `npm run check:translation-worker-pstn-audio-sink -- --json` 返回 `status=ready`，检查项包含 `pstn_audio_frame_requires_key`、`pstn_audio_frame_rejects_invalid_payload`、`pstn_audio_frame_accepted`、`pstn_audio_reached_asr`、`pstn_audio_events_published` 和 `pstn_audio_tts_playback_sent`。
- `TTS_AUDIO_SINK_ENDPOINT` 指向 PSTN Bridge `POST /translated-audio` 时，Bridge 能校验 Bearer API key、接收 PCM16 译音和 `targetSpeakerRole`，并转发到真实上游。
- `npm run check:pstn-bridge-audio -- --json` 返回 `status=ready`，检查项包含 `translated_audio_requires_bridge_key`、`translated_audio_rejects_invalid_payload`、`pstn_bridge_call_route_created`、`translated_audio_accepted`、`translated_audio_forwarded_to_upstream` 和 `translated_audio_written_to_media`；上游和媒体写入器都收到 `providerCallId/mediaStreamId` 和非空 `telephonyAudio`，编码为 `mulaw8k`、采样率为 8000。
- `npm run check:pstn-internal-media-loop -- --json` 返回 `status=ready`，检查项包含 `loop_call_route_created`、`loop_media_frame_accepted`、`loop_frame_reached_worker_asr`、`loop_caption_events_published`、`loop_tts_returned_to_bridge_upstream` 和 `loop_tts_written_to_media`。
- 总发布门禁默认包含 `pstn_internal_media_loop_readiness`；仅限局部排查可使用 `--skip-pstn-internal-media-loop`。
- 记录保存 call id、provider id、消耗分钟、状态；terminal 状态带 `consumedSeconds` 时只结算一次，并写入 `agent_call_usage` ledger。
- 余额不足或合规未通过时禁止拨号。
- 服务商媒体和状态 webhook 必须校验签名，并在 Bridge 层按 `eventId` 幂等处理；状态 webhook 到 API 后还要继续按 `eventId` 幂等。
- `CALL_PROVIDER_POLICY=domestic_pstn_bridge` 时 release-ready 校验服务商、webhook、录音/AI 提示和最大通话时长。

## 11. A8 AI Calling Agent

用例：

- 预约、客服查询、外贸询价。
- App 进入 AI 代打电话页，通过 `/ai-calling-agent/drafts` 创建话术草稿，用户确认前取消且取消后不能授权。
- 授权、通话中人工接管和接管原因记录。
- 授权后调用 `/ai-calling-agent/drafts/:draftId/start`，服务未配置时必须返回结构化不可执行原因。
- 内部 Worker 拉取 queued 任务、回写状态，并把任务提交给 `PSTN_BRIDGE_BASE_URL/agent-calls`；Bridge 失败时回写 `failed`。
- `@translation/pstn-bridge` 可独立启动，`POST /agent-calls` 必须校验 Bearer API key。
- Bridge `/health/release-ready` 在 mock provider、本地 HTTP 上游或未配置录音/转写提示时必须返回 `not_ready`。
- PSTN Bridge 通过签名 `POST /webhooks/pstn/agent-calls` 回写 `completed/failed`，可携带 `consumedSeconds`；重复 `eventId` 不重复更新，也不重复扣减用量。
- 运行 `npm run check:agent-call-worker -- --json`，验证本地隔离 API、mock PSTN Bridge、真实 Worker 的入队、调度、`in_progress` 回写、带 `consumedSeconds` 的 `completed` webhook 扣费，以及余额耗尽后的第二次 start 不能入队。
- 涉及付款、身份验证、合同、医疗、法律、金融。

通过标准：

- 未经用户确认和 `consentPromptVersion` 不拨打；拨打前展示话术、风险提示、人工接管和取消入口。
- Agent Worker、PSTN 策略或内部密钥未就绪时不得进入拨号队列，App 要显示可理解错误。
- 剩余可用秒数低于 60 秒时不得进入拨号队列，API 返回 `agent_call_insufficient_balance`，草稿保持 `authorized` 且不生成 `callId`。
- 执行状态至少覆盖 `queued`、`in_progress`、`completed`、`failed`，App 可刷新查看 call id、结果摘要、失败原因和下一步。
- `npm run dev:agent-calls` 可启动调度 Worker；未配置 `PSTN_BRIDGE_BASE_URL` 时只报告未配置，不伪造拨号成功。
- `npm run dev:pstn-bridge` 可启动 Bridge 骨架；真实发布必须配置公网 HTTPS 上游。
- `npm run check:agent-call-worker -- --json` 返回 `status=ready`，且 mock Bridge 收到 `draftId/callId`，API 详情回写 `providerCallId`，接受带 `consumedSeconds` 的签名完成 webhook，并包含 `agent_call_insufficient_balance_blocks_queue` 检查；总发布门禁默认包含 `agent_call_worker_readiness`。
- completed/failed 终态携带 `consumedSeconds` 时，API 详情必须包含 `consumedSeconds` 和 `usageSettledAt`，余额减少同等秒数，billing ledger 记录 `note=agent_call_usage`。
- 通话中可实时查看转写和状态，高风险场景必须返回接管状态，不得自动外呼。
- 结束后生成结果、摘要、失败原因和下一步。
- 保存用户授权、接管记录和 call id。

## 12. A9 支付、套餐和 credits

用例：

- Free 默认权益。
- Apple IAP Pro/Plus/Credits。
- iOS 恢复购买。
- Apple Server Notifications。
- 微信支付成功、失败、错签、金额不一致。
- 支付宝成功、失败、错签、金额不一致。
- 退款、取消订阅、重复回调。
- 本地隔离 API 回调 smoke：`npm run check:domestic-payment-callbacks -- --json --no-save`。
- `/health/ready` 支付配置缺失、短密钥、本地回调和完整配置。

通过标准：

- 服务端校验 Apple JWS、证书链、bundleId、productId、transactionId、environment。
- 微信/支付宝缺商户配置时不可下单，订单必须返回 HTTPS notifyUrl。
- iOS “恢复购买”读取 Apple 已验证交易，逐笔提交服务端订单确认，成功后刷新余额和 ledger；无可恢复交易时给出明确提示。
- 回调必须验签，金额不一致不授权。
- 重复通知不重复加 credits。
- 本地 smoke 必须覆盖微信成功回调、微信重复回调、微信错签拒绝、支付宝成功回调，并验证余额和 ledger 增量。
- 退款和取消可回滚权益。
- credits ledger 可追溯，客户端不直接改余额。
- 国内 Android 支付未完成前不公开购买入口。

## 13. A10 合规、隐私和权限

检查项：

- APP 备案材料。
- 隐私政策。
- 用户协议。
- 第三方 SDK 清单。
- 模型服务商清单。
- 权限用途说明。
- 删除记录入口。
- AI 转写、翻译、摘要、TTS 提示。

通过标准：

- 首次启动不请求无关权限。
- 使用功能时再请求对应权限。
- 默认不保存原始音频。
- 用户可删除历史记录。
- 国内版主链路不跨境调用海外模型。
- App 内可查看隐私政策、用户协议、SDK/模型服务商清单、权限说明。
- 电话翻译和 Agent 拨号前有录音/转写/AI 翻译提示。

## 14. A11 安全、日志和监控

用例：

- 日志含手机号、邮箱、token、apiKey、Apple JWS、原文、译文、音频 data。
- App 上报 Flutter/manual fatal error。
- 运维访问错误列表、详情、汇总、告警状态。
- release-ready 缺配置、fatal 阻断、配置完整。
- 管理员发送 `POST /diagnostics/app-errors/alert-test`。

通过标准：

- API/Gateway/App 上报 payload 均脱敏。
- 监控查询端点必须鉴权。
- 列表不返回 stack/context，详情仅返回脱敏内容。
- fatal 告警达到阈值时 `/health/release-ready` 返回 503。
- 支付配置、国内支付回调 smoke、监控、LiveKit、Gateway Provider、Hy-MT2 翻译 smoke、模型选型、模型路由、发布材料、Agent Call Worker、PSTN Bridge、PSTN 内部媒体闭环、服务商签名媒体/状态回调满足时总门禁返回 0。
- 本机验收遇到旧 3100/3001 服务时，使用 `npm run check:domestic-release-ready -- --env-file release/domestic/release.env --local-stack --json` 启动当前 workspace 的隔离 API/Gateway，并把真实生产配置注入本轮门禁，避免旧进程或手工 `source` 配置掩盖真实发布阻塞项。
- 正式外部告警 webhook 配置缺失时不能进入上架准备版。
- 运行 `npm run check:diagnostics-alerting -- --json`，必须通过 `/diagnostics/app-errors/alert-test` 向值班机器人投递一条真实测试告警。
- 运行 `npm run check:diagnostics-alerting -- --local-stack --webhook-format generic --json --no-save`，必须启动隔离 API 和本地 mock webhook，检查 `diagnostics_alert_webhook_received_signed_test` 为 pass，证明告警签名、测试投递和敏感详情不外发的链路可回归。
- 对 `wecom`、`feishu`、`dingtalk` 分别运行同一条 local-stack smoke，确认企业微信/飞书/钉钉机器人文本格式都可解析并验签。
- 总发布门禁默认包含 `diagnostics_alerting_local_smoke`；仅限局部排查可使用 `--skip-diagnostics-alerting-local-smoke`。
- 总发布门禁默认包含 `release_materials_readiness`；仅限局部排查可使用 `--skip-release-materials`。
- 告警测试可投递到企业微信/飞书/钉钉等值班群机器人。
- 电话服务商来音必须通过 `npm run check:pstn-provider-media-event -- --json`，服务商通话状态必须通过 `npm run check:pstn-provider-status-event -- --json`。

## 15. A12 性能、质量和成本

通过标准：

- 同传常规首译延迟 P50 <= 2 秒，P95 <= 5 秒。
- Call Link 5 分钟通话不断线。
- App 冷启动不异常请求麦克风。
- 1 小时连续 Listening 不崩溃。
- Provider 用量按 session 可审计：分段记录 provider、model、latency 和 token 估算。
- 崩溃率、fatal error、支付失败率进入监控。

## 16. A13 渠道和发布材料

通过标准：

- iOS 中国区包可构建，`LocalIdentity.xcconfig` 使用正式 bundle id。
- 国内安卓 release APK 可构建，签名主体为“北京乾坤祥云科技有限公司”。
- 截图、简介、关键词、隐私标签进入 `RELEASE_MATERIALS_FILE`，iOS 和 Android 各至少 3 张截图。
- 渠道截图可先运行 `npm run generate:domestic-release-screenshots` 生成基线素材，再替换为真实商店审核截图。
- 本地截图文件必须是真实 PNG/JPEG 图片，可读出尺寸，且短边不低于 320px，不能用文本或文件头占位替代。
- 远程截图链接必须使用 HTTPS；HTTP 截图链接不能通过发布门禁。
- 包名、主体、客服邮箱、法律 URL、备案、SDK/模型清单、客服退款和回滚方案通过 `npm run check:domestic-release-materials`、总门禁 `release_materials_readiness` 和 API release-ready。
- 真实发布环境文件通过 `npm run check:domestic-release-env -- --file release/domestic/release.env --json`；示例文件 `release/domestic/release.env.example` 不含真实密钥，预期不能通过；弱 API key/webhook secret 和非 64 位 hex 的 Apple 根证书 SHA-256 也必须失败；总发布门禁必须显示 `domestic_release_secret_hygiene=pass`，证明生产 env、Android `key.properties` 和 release keystore 已被 `.gitignore` 保护。
- 自建 LiveKit 私有 env 通过 `npm run check:livekit-selfhost-config -- --env infra/livekit-selfhost/.env --json`；`infra/livekit-selfhost/generated/` 不进入版本库。
- 总发布门禁使用 `npm run check:domestic-release-ready -- --env-file release/domestic/release.env --json` 或加 `--local-stack` 运行，确保 Hy-MT2、支付、LiveKit、诊断和 PSTN 配置来自同一个审核过的 env 文件。
- APP 备案号正式取得前在发布清单中保留 `京ICP备00000000号-1A` 占位；该占位号允许通过当前开发验收门禁，正式提交渠道前仍作为 TODO 替换。
- 客服、退款、删除账号、隐私反馈入口可用。
- `RELEASE_MATERIALS_FILE` 必须包含 `rollbackPlan`、`grayReleasePlan` 和 1-20 之间的 `initialGrayPercent`。

## 17. 当前阻塞项

支付/Provider、真实 LiveKit VM 部署和三端媒体联调、PSTN/Agent 真实服务商媒体协议和发布材料仍未完成；已完成自建 LiveKit 配置模板/门禁/渲染脚本、Call Link Worker 基础链路、Agent Call Worker 队列拉取、HTTP Bridge 调度、PSTN Bridge `/media-frames` 来音入口、服务商签名媒体/状态入口、Translation Worker PSTN audio frame sink、PSTN Bridge `/translated-audio` 译音回灌入口、失败回写和签名完成 webhook。
