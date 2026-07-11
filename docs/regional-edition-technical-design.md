# 国内版 / 国际版技术补充设计

版本：v0.1  
日期：2026-07-02  
关联：`docs/ai-communication-technical-design.md`、`docs/ai-communication-development-plan.md`

## 1. 架构原则

国内版和国际版不拆成两套代码，而是共享核心工程：

```text
Flutter App
API Server
Realtime Gateway
Call Orchestrator
Provider Router
Billing / Records / Terms / Summary
```

区域差异通过配置、Provider Adapter、支付 Adapter、合规文案和部署环境解决。

## 2. RegionEditionConfig

```ts
interface RegionEditionConfig {
  edition: "domestic" | "international";
  defaultCountry: "CN" | "US" | "CA";
  allowedProviders: string[];
  paymentStack: string[];
  dataRegion: string;
  callProviderPolicy: "call_link_only" | "pstn_enabled";
  complianceProfile: "pipl" | "us_ca";
}
```

配置来源：

- App build-time dart-define。
- API Server 环境变量。
- 后台 remote config。
- 用户账号 region 不能由客户端随意切换。

## 3. Provider Router 分区

国际版 Provider：

| 能力 | 首选 | 备选 |
| --- | --- | --- |
| Realtime Translation | OpenAI GPT-Realtime-Translate | Gemini Live Translate |
| ASR | OpenAI/Gemini/端侧 ASR | Whisper/SenseVoice |
| Summary/Agent | OpenAI/Gemini 小模型 | 自部署 Qwen |
| TTS | 系统 TTS/OpenAI/Google | Azure |
| OCR | iOS Vision / ML Kit | Google Vision |
| PSTN | Twilio | Telnyx |

国内版 Provider：

| 能力 | 首选 | 备选 |
| --- | --- | --- |
| Realtime Translation | Qwen LiveTranslate | 腾讯 TRTC AI 翻译 |
| ASR | 端侧 ASR / SenseVoice | 阿里/腾讯 ASR |
| Summary/Agent | Qwen | 腾讯混元 / 自部署 |
| TTS | 系统 TTS / 阿里 TTS | 腾讯 TTS / CosyVoice |
| OCR | 系统 OCR | 阿里/腾讯 OCR |
| PSTN | 首期不启用 | 合规通信伙伴 |

## 4. 部署拓扑

国际版：

```text
US region API
US region Realtime Gateway
US region Call Orchestrator
OpenAI/Gemini
Twilio/Telnyx
Object Storage US
```

国内版：

```text
CN region API
CN region Realtime Gateway
CN region Model Gateway
Qwen/Tencent/Self-hosted
Object Storage CN
Domestic payment callbacks
```

隔离要求：

- 数据库按 region 分库或独立 schema。
- 文件存储按 region 分桶。
- 日志和监控不跨境传输个人数据。
- Provider key 独立管理。

## 5. 客户端差异

Flutter 共享页面：

- 同传、通话、扫描、记录、我的。

区域差异：

| 模块 | 国际版 | 国内版 |
| --- | --- | --- |
| 分享 | WhatsApp、SMS、Email | 微信、短信、QQ、钉钉 |
| 支付 | Apple IAP、Google Play、Stripe | Apple IAP、微信、支付宝、安卓渠道 |
| 隐私文案 | AI translation consent | 个人信息与录音转写提示 |
| 拨号 | 美国/加拿大 PSTN | 默认隐藏或仅预约候补 |
| Provider 诊断 | OpenAI/Gemini/Twilio | Qwen/Tencent/自部署 |

## 6. 支付 Adapter

统一接口：

```ts
interface PaymentProvider {
  createPurchase(input: PurchaseInput): Promise<PurchaseIntent>;
  verifyReceipt(input: ReceiptInput): Promise<VerifiedPurchase>;
  handleWebhook(event: PaymentWebhook): Promise<void>;
}
```

实现：

- `AppleIapProvider`
- `GooglePlayBillingProvider`
- `StripeProvider`
- `WechatPayProvider`
- `AlipayProvider`
- `AndroidChannelPayProvider`

权益以服务端 subscription + credits ledger 为准。

## 7. 电话功能区域策略

国际版：

- P1：Call Link。
- P2：Twilio/Telnyx 拨打美国/加拿大手机号。
- P2：AI Calling Agent。

国内版：

- P1：Call Link。
- P2：面向海外号码的拨打测试可隐藏灰度。
- P3：评估国内合规通信伙伴。
- 不做“直接翻译系统电话”承诺。

## 8. 模型选择策略

实时同传：

- 国际版：OpenAI Realtime 和 Gemini Live Translate 双 POC，按延迟、稳定性、价格定主链路。
- 国内版：Qwen LiveTranslate 和腾讯 TRTC AI 翻译双 POC。

摘要/重点/术语：

- 使用文本 LLM，优先小模型。
- 可异步生成，不阻塞通话结束。
- 国内版使用 Qwen/混元/自部署，国际版使用 OpenAI/Gemini。

端侧：

- 保留 iOS CoreML/Nemotron ASR。
- Android 后续接系统 ASR/ML Kit。
- 不在手机端首发内置大 LLM。

## 9. 合规和审计

统一审计事件：

```text
consent.accepted
call.created
call.connected
record.deleted
payment.verified
agent.takeover_required
provider.requested
```

国内版额外：

- 权限最小化。
- 个人信息导出/删除。
- 数据处理目的说明。
- 模型服务商清单。

国际版额外：

- 通话录音/转写 consent profile。
- Stripe/Apple/Google 订阅状态同步。
- 电话号码和 call id 脱敏。

## 10. 开发补充计划

当前按国内版优先调整，在原 M0-M9 基础上增加区域化任务：

| 阶段 | 区域化任务 |
| --- | --- |
| M1 | 新增 RegionEditionConfig，默认 domestic |
| M2 | 国内文案、微信/短信分享、隐私入口 |
| M3 | 国内 Qwen/Tencent/self-hosted Provider POC |
| M4 | payment adapter 和 credits ledger 区域字段 |
| M5 | 国内版 Call Link，上线时隐藏 PSTN |
| M6 | 国内 OCR provider 分流 |
| M7 | Apple IAP、微信/支付宝支付准备 |
| M8 | AI Agent 国内场景灰度 |
| M9 | APP 备案、国内安卓渠道、发布材料 |

## 11. 环境变量

```text
REGION_EDITION=international|domestic
DATA_REGION=us|cn
REALTIME_PROVIDER=openai|gemini|qwen_live|tencent_trtc|lmstudio
SUMMARY_PROVIDER=openai|gemini|qwen|lmstudio
OCR_PROVIDER=vision|mlkit|google|aliyun|tencent
CALL_PROVIDER=livekit|twilio|telnyx|call_link_only
PAYMENT_PROVIDER=apple|google|stripe|wechat|alipay|channel
COMPLIANCE_PROFILE=us_ca|pipl
```

## 12. 验收标准

国际版：

- OpenAI/Gemini 至少一个实时 Provider POC 通过。
- Call Link 可用。
- 美国/加拿大 PSTN POC 可拨通。
- Apple/Google/Stripe 沙盒支付至少一个通过。

国内版：

- Qwen/Tencent 至少一个实时 Provider POC 通过。
- 国内网络下 API、同传、摘要可用。
- 微信/支付宝或 Apple IAP 沙盒流程通过。
- PSTN 功能默认隐藏或明确标为暂不可用。

## 13. 资料来源

- OpenAI GPT-Realtime-Translate: https://developers.openai.com/api/docs/models/gpt-realtime-translate
- Google Gemini Live Translate: https://ai.google.dev/gemini-api/docs/live-api/live-translate
- Qwen LiveTranslate: https://www.alibabacloud.com/help/en/model-studio/qwen3-5-livetranslate-flash-realtime
- Tencent TRTC AI Transcription and Translation: https://www.tencentcloud.com/document/product/647/66148
