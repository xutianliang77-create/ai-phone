# 国内版 App 功能完成度矩阵

版本：v1.2  
日期：2026-07-08  
依据：`docs/domestic-app-detailed-functional-design.md`、`docs/domestic-edition-development-plan.md`、`docs/domestic-edition-acceptance-plan.md`、`docs/domestic-design-review-action-plan.md`、`docs/domestic-account-identity-compliance-design.md`、`docs/domestic-technical-design-merge-plan.md`、`docs/domestic-realtime-billing-data-design.md`、`docs/llm-asr-refinement-and-record-review-functional-design.md`、`docs/llm-asr-refinement-functional-design.md`、`docs/llm-record-review-functional-design.md`、`docs/fluidvoice-source-review-and-adoption-plan.md`

## 1. 状态口径

| 状态 | 含义 |
| --- | --- |
| 已完成 | 代码、自动化测试或门禁已有覆盖，且不依赖外部生产配置即可证明基本功能闭环。 |
| 基本完成，待真实验收 | 代码和脚本闭环已具备，但还需要真机、真实模型、真实媒体、支付沙盒或渠道材料证明。 |
| 部分完成 | 已有页面、API、Worker 或脚本骨架，但核心产品闭环仍缺一段。 |
| 未完成 | 仅有设计或占位，没有达到可测试闭环。 |
| 发布阻塞 | 上架或商业发布前必须补齐；内测可带限制或隐藏。 |

## 2. 总体结论

当前国内版已经具备 P0/P1 的主要产品骨架：五 Tab、中文界面、端侧同传、在线模型路由、历史、扫描、Call Link 控制面、AI Agent 控制面、PSTN Bridge 骨架、支付服务端和发布门禁均已成形。

距离“发布的产品水平”仍有四类关键缺口：

- 真实体验验收：iPhone/Android 真机同传、在线模式、Call Link 双端 5 分钟、TTS 听感、OCR 40 张素材。
- 生产配置：`release/domestic/release.env`、支付商户、告警 webhook、公网 LiveKit DNS/TLS、PSTN Bridge 真实上游。
- 真实媒体闭环：Call Link 已有脚本级 Beelink media readiness，但还未完成真人 Host + Guest + Worker + ASR/翻译/TTS 听感闭环。
- 商业电话能力：PSTN/AI Agent 控制面和内部媒体闭环已有，真实服务商媒体协议、拨号合规和灰度发布仍未完成。
- 设计审核新增阻断：账号身份、微信 WebView WebRTC 基础能力、首启隐私同意和云端语音敏感信息单独同意已完成基础实现，仍需真机和合规文案验收；被叫告知、面对面自动朗读防回声、FireRedASR2 实时策略、单位经济、Android 国内端侧 ASR 都必须补齐后才能宣称发布级。
- 外部技术设计评审稿已完成合并口径确认：当前 P0/P1 保留现有 Flutter + Node/TypeScript + Python + LiveKit + CoreML/Nemotron 架构，sherpa-onnx、Go 微服务和完整平台化数据栈列为后续目标架构 TODO。

## 3. P0 内测功能

| 功能 | 状态 | 当前证据 | 缺口和下一步 |
| --- | --- | --- | --- |
| 五 Tab 中文 App Shell | 已完成 | `apps/mobile/lib/src/features/shell/presentation/pages/main_shell_page.dart`、`scripts/check_mobile_chinese_interface.mjs`、`scripts/check_mobile_app_release_readiness.mjs` | 继续做小屏/大屏真机截图复核。 |
| 国内版区域配置 | 已完成 | `apps/mobile/lib/src/app/region_edition_config.dart`、`services/api-server/src/config/env.ts`、`services/realtime-gateway/src/config/env.ts` | 生产 env 仍需真实值。 |
| 端侧 / 在线显式开关 | 已完成 | `apps/mobile/lib/src/features/realtime/data/realtime_runtime_settings.dart`、`apps/mobile/lib/src/features/realtime/presentation/widgets/realtime_settings_panel.dart` | 真机复测切换不可在同传中误触。 |
| Hy-MT2 语言设置 | 已完成 | `apps/mobile/lib/src/platform/translation/supported_translation_language.dart`、`apps/mobile/lib/src/features/realtime/presentation/widgets/translation_language_picker.dart`、`services/api-server/src/modules/realtime/create-session-request.ts` | 多语言是灰度能力，中英质量仍优先验收。 |
| iOS 端侧 ASR | 基本完成，待真实验收 | `apps/mobile/lib/src/platform/asr/core_ml_nemotron_asr_provider.dart`、`scripts/check_ios_coreml_runtime.mjs`、`scripts/check_ios_native_asr_bridge.mjs` | 需继续跑真机语料：短句、长句、噪声、快速切换。 |
| Android 系统 ASR 兜底 | 基本完成，待真实验收 | `apps/mobile/lib/src/platform/asr/android_system_asr_provider.dart`、`apps/mobile/test/android_system_asr_provider_test.dart` | 需要 Android 模拟器或真机确认。 |
| 自动语种反向互译 | 基本完成，待真实验收 | `apps/mobile/lib/src/features/realtime/presentation/controllers/realtime_controller_local_translation.dart`、`apps/mobile/test/realtime_controller_on_device_translation_test.dart` | 中英快速切换 20 轮仍需真机验收。 |
| flush 不漏最后一句 | 基本完成，待真实验收 | `apps/mobile/lib/src/features/realtime/presentation/controllers/realtime_controller_stop.dart`、`apps/mobile/test/realtime_controller_pause_flush_test.dart` | 在线模型真实链路仍需复测。 |
| 静音噪声过滤 | 已完成 | `apps/mobile/test/realtime_controller_silence_filter_test.dart`、`services/translation-worker/src/worker/transcript-text-normalizer.ts` | 真实在线模式需确认不再出现 `<sil>`。 |
| 字幕自动滚动 | 已完成 | `apps/mobile/lib/src/features/realtime/presentation/widgets/subtitle_timeline.dart`、`apps/mobile/test/subtitle_timeline_test.dart` | 真机长列表复测，必要时补“回到底部”。 |
| 自动朗读译文 | 部分完成 | `apps/mobile/lib/src/features/realtime/presentation/pages/realtime_page_online_helpers.dart`、`apps/mobile/lib/src/features/realtime/presentation/widgets/realtime_settings_panel.dart`、`apps/mobile/test/realtime_settings_panel_test.dart`、`apps/mobile/ios/Runner/SpeechOutputBridge.swift` | Type-to-Speak 朗读可用；实时同传页暂禁用系统 TTS 自动朗读，避免 iOS 音频会话打断连续 ASR。后续需实现“暂停识别后播放/平台 AEC”再开放。 |
| Listening Mode | 基本完成，待真实验收 | `apps/mobile/lib/src/features/realtime/presentation/pages/realtime_page.dart`、`apps/mobile/lib/src/features/realtime/presentation/widgets/realtime_controls.dart` | 需确认默认不播 TTS、结束保存和会后摘要。 |
| Type-to-Speak | 已完成 | `apps/mobile/lib/src/features/type_to_speak/presentation/pages/type_to_speak_page.dart`、`apps/mobile/lib/src/features/type_to_speak/presentation/controllers/type_to_speak_controller.dart`、`apps/mobile/test/type_to_speak_page_test.dart` | 通话中“播放给对方”仍依赖 Call Link/PSTN 媒体链路。 |
| 历史保存和详情 | 已完成 | `apps/mobile/lib/src/features/history/presentation/pages/session_history_page.dart`、`apps/mobile/lib/src/features/history/presentation/pages/session_detail_page.dart`、`apps/mobile/test/session_detail_page_test.dart` | 真机全流程复测。 |
| Markdown 导出分享 | 基本完成，待真实验收 | `apps/mobile/lib/src/platform/sharing/local_file_share_service.dart`、历史详情导出代码 | 需要真机调起系统分享验证。 |
| 模型链路诊断 | 已完成 | `apps/mobile/lib/src/features/device_asr/presentation/widgets/api_health_panel.dart`、`apps/mobile/test/core_ml_nemotron_diagnostics_page_test.dart` | 真实 Beelink 服务启动后复测。 |

## 4. P1 灰度功能

| 功能 | 状态 | 当前证据 | 缺口和下一步 |
| --- | --- | --- | --- |
| 在线模型路由 | 已完成 | `release/domestic/model-routing.json`、`scripts/check_model_routing_config.mjs`、`scripts/render_model_routing_env.mjs` | 生产端点需从 Tailscale/本地替换为审核可用路径。 |
| FireRedASR2-AED 服务 | 基本完成，待真实验收 | `services/model-services/asr-service/app/firered_engine.py`、`services/model-services/asr-service/tests/test_firered_engine.py` | 需固定真实语料指标，确认在线 ASR 质量。 |
| Hy-MT2 翻译服务 | 基本完成，待真实验收 | `services/model-services/translation-service/app/hymt2_engine.py`、`release/domestic/model-selection-report.json` | 需在线模式真机复测空结果、拒译和延迟。 |
| VoxCPM2 TTS 服务 | 基本完成，待真实验收 | `services/model-services/tts-service/app/voxcpm2_engine.py`、`scripts/check_tts_provider_readiness.mjs` | 需真人听感、并发和公网 HTTPS 路径。 |
| OpenAI-compatible 译文防拒译 | 已完成 | `services/realtime-gateway/src/providers/lmstudio/lmstudio-realtime-provider.ts`、`services/translation-worker/src/providers/openai-compatible-translation-provider.ts` | 继续收集真实拒译样本。 |
| Call Link 创建和 Host 入房 | 基本完成，待真实验收 | `apps/mobile/lib/src/features/call_link/presentation/pages/call_link_page.dart`、`services/api-server/src/modules/call-links/call-links.routes.ts` | 真机 Host 入房和微信分享需复测。 |
| Web Guest 免安装入房 | 基本完成，待真实验收 | `services/api-server/src/modules/call-links/call-web-assets.ts`、`services/api-server/src/modules/call-links/call-web-guest-script.ts`、`services/api-server/src/modules/call-links/call-web-guest-script.test.ts`、`apps/mobile/lib/src/features/call_link/presentation/pages/join_call_link_page.dart` | 微信内浏览器、Safari、Chrome 真机矩阵仍要验收。 |
| Call Link Worker 字幕/TTS 事件 | 基本完成，待真实验收 | `services/translation-worker/src/worker/call-translation-worker.ts`、`scripts/check_call_link_livekit_worker_readiness.mjs` | 已有脚本门禁；缺真人双端说话验收。 |
| LiveKit 译音轨回灌 | 基本完成，待真实验收 | `services/translation-worker/src/worker/livekit-tts-audio-sink.ts`、`.cache/beelink-livekit-room-media-readiness-20260706.json` | 缺 App Host + Web Guest 真实听感验证。 |
| Call Link 历史和扣费 | 基本完成，待真实验收 | `services/api-server/src/modules/call-links/call-links.service.ts`、`services/api-server/src/modules/usage/usage.service.ts` | 重复结束不重复扣费需真实流程复测。 |
| OCR 扫描翻译 | 基本完成，待真实验收 | `apps/mobile/lib/src/features/scan/presentation/pages/scan_translation_page.dart`、`apps/mobile/test/scan_translation_page_test.dart` | 需要 iOS/Android 和 40 张素材验收。 |
| 摘要、重点、术语 | 基本完成，待真实验收 | `services/api-server/src/modules/sessions/session-review.ts`、`services/api-server/src/modules/terms/terms.repository.ts`、`apps/mobile/lib/src/features/history/presentation/widgets/session_terms_tab.dart` | 需要真实历史记录复盘验证。 |
| LLM ASR 文本优化 | 未完成 | `docs/llm-asr-refinement-functional-design.md`、`docs/llm-asr-refinement-and-record-review-functional-design.md`、`docs/fluidvoice-source-review-and-adoption-plan.md` | TODO：新增 LLM Provider 抽象和 Provider fingerprint 验证；session segment 保存 `rawText/optimizedText/translatedText`；实现实时超时回退、端侧云端同意门禁和真机质量验收。 |
| LLM 会议纪要/通信记录整理 | 部分完成 | `services/api-server/src/modules/sessions/session-review.ts`、`apps/mobile/lib/src/features/history/presentation/pages/session_detail_page.dart`、`docs/llm-record-review-functional-design.md` | TODO：改造 `/sessions/:sessionId/review` 结构化输出；App 历史详情展示纪要、待办、全文原始识别、智能优化、译文和 Markdown 导出。 |
| 支付服务端 | 部分完成 | `services/api-server/src/modules/billing`、`scripts/check_domestic_payment_callbacks_readiness.mjs` | Apple/微信/支付宝真实沙盒和商户配置未完成。 |
| 合规中心 | 基本完成，待真实验收 | `apps/mobile/lib/src/features/compliance/presentation/pages/compliance_center_page.dart`、`apps/mobile/lib/src/features/compliance/presentation/pages/compliance_consent_gate.dart`、`release/domestic/release-materials.json` | 法务/渠道材料、真实备案号和内容举报入口仍需最终替换或补齐。 |
| 账号与首启合规 | 部分完成 | `docs/domestic-account-identity-compliance-design.md`、`services/api-server/src/modules/account/account.routes.ts`、`services/api-server/src/modules/account/account.service.ts`、`services/api-server/src/modules/account/account-auth.ts`、`services/api-server/src/modules/account/account-readiness.ts`、`services/api-server/src/modules/account/account-consent.service.ts`、`services/api-server/src/modules/account/sms-provider.ts`、`services/api-server/src/modules/account/sms-otp-limits.ts`、`services/api-server/src/modules/health/release-readiness.ts`、`apps/mobile/lib/src/features/account/presentation/pages/account_page.dart`、`apps/mobile/lib/src/features/account/data/account_api_client.dart`、`apps/mobile/lib/src/features/compliance/presentation/pages/compliance_consent_gate.dart`、`apps/mobile/lib/src/features/compliance/presentation/widgets/voice_processing_consent_dialog.dart`、`apps/mobile/test/account_page_test.dart`、`apps/mobile/test/widget_test.dart` | 首启隐私同意、云端语音敏感信息单独同意、同意记录审计、手机号验证码登录、真实 SMS Provider 边界、验证码 60 秒重发、24 小时次数和失败锁定、游客边界服务端强制、账号发布安全门禁、退出登录、个人信息副本导出和注销请求已完成基础实现；仍需真实短信商户/模板/回执联调、SDK 初始化实测、登录态失效联动，以及同传/Call Link/AI Agent 真机同意链路验收。 |
| 微信 WebView WebRTC 兼容 | 基本完成，待真实验收 | `services/api-server/src/modules/call-links/call-web-assets.ts`、`services/api-server/src/modules/call-links/call-web-guest-script.ts`、`services/api-server/src/modules/call-links/call-web-guest-script.test.ts` | Web Guest 已补能力检测、系统浏览器打开引导、复制链接降级、仅字幕模式和点击加入时音频解锁；仍需微信/Safari/Chrome/Android 主流机型真机矩阵验收。 |
| 面对面自动朗读防回声 | 部分完成 | `apps/mobile/lib/src/features/realtime/presentation/pages/realtime_page_online_helpers.dart`、`apps/mobile/lib/src/features/realtime/presentation/widgets/realtime_settings_panel.dart`、`apps/mobile/test/realtime_settings_panel_test.dart` | 真机确认系统 TTS 会打断 iOS 端侧连续 ASR；同传页已禁用自动朗读以保护字幕主链路。后续需独立实现暂停 ASR 后播放、耳机模式或平台 AEC。 |

## 5. P2 商业能力

| 功能 | 状态 | 当前证据 | 缺口和下一步 |
| --- | --- | --- | --- |
| 拨打手机号页面和控制面 | 部分完成 | `services/api-server/src/modules/calls/pstn-readiness.ts`、`services/pstn-bridge/src/server.ts`、`docs/poc/pstn-bridge-runbook.md` | App 拨号入口、真实号码拨打和合规提示仍需完整验收。 |
| PSTN Bridge 媒体入口 | 基本完成，待真实验收 | `services/pstn-bridge/src/server.ts`、`scripts/check_pstn_bridge_media_ingest_readiness.mjs` | 真实服务商 websocket/session 协议未接。 |
| PSTN 译音回灌 | 基本完成，待真实验收 | `services/pstn-bridge/src/server.ts`、`scripts/check_pstn_bridge_audio_readiness.mjs` | 真实电话侧听到译音未验收。 |
| Translation Worker PSTN audio sink | 基本完成，待真实验收 | `services/translation-worker/src/pstn-audio-sink/main.ts`、`scripts/check_translation_worker_pstn_audio_sink_readiness.mjs` | 缺真实 PSTN 来音驱动。 |
| PSTN 内部媒体闭环 | 基本完成，待真实验收 | `scripts/check_pstn_internal_media_loop_readiness.mjs` | 只是内部 mock/本地链路，不等同真实服务商。 |
| AI Calling Agent App 页面 | 部分完成 | `apps/mobile/lib/src/features/ai_calling_agent/presentation/pages/ai_calling_agent_page.dart`、`apps/mobile/test/ai_calling_agent_page_test.dart` | 人工接管、通话中监控和真实外呼体验未完成。 |
| AI Agent Worker 队列 | 基本完成，待真实验收 | `services/translation-worker/src/agent-calls`、`scripts/check_agent_call_worker_readiness.mjs` | 真实 PSTN Bridge/provider 未接。 |
| AI Agent 风险控制 | 部分完成 | `services/api-server/src/modules/agent-calls/agent-call-risk.ts` | 高风险场景、接管策略和文案需产品/法务复核。 |

## 6. 发布门禁和生产配置

| 项目 | 状态 | 当前证据 | 发布阻塞 |
| --- | --- | --- | --- |
| 移动端发布门禁 | 基本完成，待构建验收 | `scripts/check_mobile_app_release_readiness.mjs` | 还需 iOS/Android 真机构建和商店签名配置。 |
| 总发布门禁 | 部分完成 | `scripts/check_domestic_release_readiness.mjs` | 真实 `release/domestic/release.env` 未填齐，生产配置仍阻塞。 |
| 模型选型报告 | 已完成 | `release/domestic/model-selection-report.json` | 后续模型替换必须重新评测。 |
| 模型路由 | 已完成 | `release/domestic/model-routing.json` | 生产 endpoint 和密钥需真实化。 |
| 实时协议、计费与数据设计 | 部分实现 | `docs/domestic-realtime-billing-data-design.md`、`services/api-server/src/modules/sessions/session-usage-settlement.ts`、`services/api-server/src/modules/sessions/session-usage-refund.ts`、`services/api-server/src/modules/usage/usage.service.ts`、`services/realtime-gateway/src/usage/usage-ticker.ts`、`apps/mobile/lib/src/features/realtime/presentation/widgets/realtime_status_bar.dart` | usage settlement、`<6s` 免计费、session ledger 元数据、持久化幂等键、低余额 graceful end、`usage.hold` 启动预留、基础用量退款和 App 低余额提示已接入；仍需 segment 诊断字段、云端数据生命周期、PostgreSQL 账本和运营退款后台。 |
| LiveKit 自建配置 | 基本完成，待生产部署 | `infra/livekit-selfhost`、`scripts/check_livekit_selfhost_config.mjs`、`docs/poc/beelink-livekit-selfhost-deployment.md` | 公网 DNS/TLS/TURN 仍需完成。 |
| Beelink LiveKit media readiness | 已完成脚本级验收 | `.cache/beelink-livekit-room-media-readiness-20260706.json` | 仍需真人 Host + Guest + Worker 体验验收。 |
| 外部技术设计合并计划 | 已完成 | `docs/domestic-technical-design-merge-plan.md` | 仍需执行账号、实时协议、计费数据、Call Link Guest、PSTN/Agent、内容安全等具体合并任务。 |
| 诊断告警 | 部分完成 | `services/api-server/src/modules/diagnostics`、`scripts/check_diagnostics_alerting_readiness.mjs` | 真实告警 webhook 和 on-call 配置未完成。 |
| 发布材料 | 部分完成 | `release/domestic/release-materials.json`、`release/domestic/screenshots` | 截图、备案、隐私、SDK 清单需渠道复核。 |
| APP 备案号 | 开发占位 | `release/domestic/release-materials.json`、`docs/domestic-edition-acceptance-plan.md` | 正式提交前替换真实备案号。 |
| 单位经济和容量模型 | 未完成 | `docs/domestic-design-review-action-plan.md`、`release/domestic/model-selection-report.json` | 已有模型 RTF/首包报告，但缺三模型串联成本、并发、毛利和 P95/P99 SLO。 |
| 国内版合规能力矩阵 | 未完成 | `docs/domestic-design-review-action-plan.md` | 需覆盖 App/ICP/算法备案、AI 标识、被叫告知、内容安全、SDK 清单、数据流向、等保和投诉举报。 |

## 7. 优先开发顺序

### 第一优先级：真实体验闭环

1. 启动真实 `translation-worker`，用 App Host + Web Guest 测 Call Link 真人说话。
2. 验证 ASR -> Hy-MT2 -> VoxCPM2 -> `translation-tts-*` 音轨回灌。
3. 真机复测端侧同传：自动语言、flush、自动朗读、自动滚动、历史保存。
4. 真机复测在线同传：provider 空结果、错误恢复、端侧/在线切换。
5. 继续把登录 token 接入在线同传、Call Link、支付和 AI Agent，并真机复验云端语音单独同意链路，避免继续开发出无登录归属、无可审计同意记录的云端能力。

### 第二优先级：发布配置闭环

1. 补真实 `release/domestic/release.env`。
2. 接入真实告警 webhook。
3. 完成 LiveKit 公网 DNS/TLS/TURN。
4. 跑 `check:domestic-release-ready` 并保留 JSON 证据。

### 第三优先级：商业化闭环

1. Apple IAP 沙盒真机验收。
2. 微信/支付宝商户沙盒或渠道支付方案确认。
3. 国内 Android 购买入口继续隐藏直到 native 支付接通。

### 第四优先级：PSTN 和 Agent 灰度

1. 选择真实 PSTN/VoIP 服务商或 Fonoster-compatible facade。
2. 接真实媒体协议。
3. 完成拨号、接通、无人接听、失败退款、用量结算。
4. 完成 AI Agent 人工接管和高风险场景限制。

## 8. 当前不能宣称完成的事项

- 不能宣称国内版已经达到商业发布水平。
- 不能宣称拨打手机号翻译电话已可商用。
- 不能宣称 Call Link 已完成真人双端听感验收。
- 不能宣称支付已可正式收费。
- 不能宣称所有 Hy-MT2 支持语言都达到中英同等质量。
- 不能宣称可以直接翻译系统电话、微信、WhatsApp、Telegram 或 LINE 原生通话。
