# 国内版 / 国际版产品补充设计

版本：v0.1  
日期：2026-07-02  
关联：`docs/ai-communication-feature-design.md`、`docs/ai-communication-ui-design.md`

## 1. 核心原则

- 一套产品内核，两套区域配置。
- 同一套 Flutter 代码，按 `REGION_EDITION=domestic|international` 切换功能、模型、支付和合规文案。
- 国内版优先解决中国用户出境、外贸、留学、跨境客服。
- 国际版优先解决北美华人、新移民、留学生、商务和医疗/政务沟通。
- 不在国内版调用不可稳定访问的海外 AI 服务。
- 不在国际版默认接入中国大陆模型服务。

## 2. 版本定位

| 项目 | 国内版 | 国际版 |
| --- | --- | --- |
| 名称方向 | AI 同声传译 / 跨境通话翻译 | AI Chinese-English Interpreter |
| 首发人群 | 外贸、出境旅行、留学准备、跨境客服 | 北美华人、留学生、移民、商务、医疗陪同 |
| 首发语言 | 中英优先，逐步扩展日韩、东南亚 | 中英优先，逐步扩展西语、法语 |
| 主卖点 | 国内网络可用、微信/支付宝、外贸术语 | 低延迟、隐私、电话翻译、会话记录 |
| 首发渠道 | iOS 中国区、国内安卓应用商店、官网 APK | App Store US/CA、Google Play、官网 |

## 3. 功能差异

| 功能 | 国内版 | 国际版 |
| --- | --- | --- |
| 面对面同传 | 必做 | 必做 |
| Listening Mode | 必做 | 必做 |
| Type-to-Speak | 必做 | 必做 |
| 历史/摘要/重点 | 必做 | 必做 |
| Call Link | P1，微信分享优先 | P1，WhatsApp/SMS/Email 优先 |
| 拨打手机号 | P2，首期不支持中国大陆 PSTN 商用 | P2，先支持美国/加拿大 |
| AI Calling Agent | P2/P3，先外贸和客服查询 | P2，预约/客服/查询 |
| 扫描翻译 | P1，菜单/合同/外贸单据 | P1，菜单/表格/医疗材料 |
| 术语库 | 外贸、产品、报关、物流 | 医疗、学校、地产、保险 |
| 自定义语音 | P3，严格授权 | P3，严格授权 |

## 4. 模型与能力定位

国内版：

- 实时翻译：阿里 Qwen LiveTranslate 或腾讯 TRTC AI 转写翻译优先。
- ASR：端侧 ASR + SenseVoice / 云 ASR。
- 摘要/Agent：Qwen 系列或国内云模型。
- TTS：系统 TTS、阿里/腾讯 TTS、CosyVoice 自部署。
- OCR：系统 OCR、国内 OCR 服务。

国际版：

- 实时翻译：OpenAI Realtime Translation、Gemini Live Translate 优先。
- ASR：端侧 ASR + OpenAI/Gemini/Whisper 兜底。
- 摘要/Agent：OpenAI/Gemini 小模型。
- TTS：系统 TTS、OpenAI/Google/Azure TTS 备选。
- OCR：iOS Vision、Android ML Kit、Google Vision 兜底。

## 5. 支付与订阅

| 项目 | 国内版 | 国际版 |
| --- | --- | --- |
| iOS | Apple IAP | Apple IAP |
| Android | 微信支付、支付宝、渠道支付 | Google Play Billing |
| 官网 | 微信/支付宝 | Stripe |
| 计费单位 | 分钟包、月卡、年卡 | subscription + credits |
| 电话翻译 | 按分钟/credits，国内 PSTN 另行评估 | 按分钟/credits |

推荐套餐：

- Free：每月 30 分钟同传。
- Pro：同传、历史、导出、摘要。
- Plus：通话房间、术语库、高质量模型。
- Credits：拨打手机号、AI Agent、云 TTS、云 OCR。

## 6. 合规与隐私

国内版重点：

- 用户协议、隐私政策、个人信息保护。
- 语音、手机号、通讯录、相机权限按场景触发。
- 数据存储和模型调用在国内可控区域。
- AI 生成内容标识和用户授权记录。
- 电话/录音/转写合规单独评估，不把中国大陆 PSTN 作为首发。

国际版重点：

- 明确 AI 翻译、转写、摘要提示。
- 默认不保存原始音频。
- 支持用户删除记录。
- 电话翻译按美国/加拿大 consent 文案配置。
- 手机号脱敏和日志脱敏。

## 7. 渠道和运营

国内版关键词：

- 同声传译、实时翻译、出国翻译、外贸翻译、会议翻译、电话翻译。

国际版关键词：

- AI interpreter, Chinese English translator, live translation, phone translator, meeting captions.

国内获客：

- 小红书、抖音、微信社群、外贸社群、留学机构。

国际获客：

- App Store ASO、Google Play、TikTok、YouTube、Reddit、华人社区、留学社群。

## 8. 发布顺序

当前决策改为国内版优先：

1. 国内版内测：现有端侧 ASR + 国内 Provider POC + 历史记录。
2. 国内版功能闭环：Listening Mode、Type-to-Speak、摘要、重点、术语。
3. 国内版 Call Link：微信/短信分享，网页免安装加入。
4. 国内版扫描翻译：菜单、合同、外贸单据。
5. 国内版支付与合规：Apple IAP、微信/支付宝准备、APP 备案材料。
6. 国际版复用同一套能力，再接 OpenAI/Gemini 和美国/加拿大 PSTN。

原因：

- 用户明确国内版优先。
- 国内版不能依赖海外 AI 服务作为主链路。
- 中国大陆 PSTN 电话翻译合规和通信伙伴复杂，首发先做 Call Link。

## 9. 产品配置

```text
REGION_EDITION=international
DEFAULT_COUNTRY=US
DEFAULT_LANGUAGE_PAIR=zh-en
PAYMENT_STACK=apple_iap,google_play,stripe
REALTIME_PROVIDER=openai|gemini|local
CALL_PROVIDER=twilio|telnyx|livekit
```

```text
REGION_EDITION=domestic
DEFAULT_COUNTRY=CN
DEFAULT_LANGUAGE_PAIR=zh-en
PAYMENT_STACK=apple_iap,wechat_pay,alipay,android_channel
REALTIME_PROVIDER=hymt2_self_hosted|qwen_live|tencent_trtc|self_hosted
CALL_PROVIDER=call_link_only|domestic_carrier_partner
```

## 10. 资料来源

- OpenAI Realtime Translation: https://developers.openai.com/api/docs/models/gpt-realtime-translate
- Google Gemini Live Translate: https://ai.google.dev/gemini-api/docs/live-api/live-translate
- Alibaba Qwen LiveTranslate: https://www.alibabacloud.com/help/en/model-studio/qwen3-5-livetranslate-flash-realtime
- Tencent TRTC AI Transcription and Translation: https://www.tencentcloud.com/document/product/647/66148
