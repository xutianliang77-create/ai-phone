# AI 翻译与实时同传专项市场调研

调研日期：2026-07-02  
调研重点：AI voice translator、AI phone call translator、AI meeting translator、实时语音到语音翻译模型、端侧 AI 翻译、AI 总结/词表/纠错等产品化能力。  
结论用途：补充主市场调研报告，指导本项目下一步 AI 功能优先级和商业化定位。

## 1. 核心判断

1. AI 翻译正在从“文本翻译工具”升级为“实时沟通平台”。最新竞品不再只卖 text/photo/voice translation，而是卖 call translation、video call translation、meeting captions、AI summaries、call transcripts、key point highlighting、custom dictionary、voice cloning、AI calling agent。
2. 真正付费能力来自高频高价值场景：跨语言电话、视频会议、商务沟通、课堂/讲座、医疗/政务/客服，而不是普通查词。
3. 头部 AI 翻译 App 的包装方式已经明显同质化：多语言、实时、AI、电话、会议、照片、文档、历史、总结。我们的差异化必须更具体：中英实时同传稳定性、端侧隐私、低延迟字幕、会后沉淀、领域词纠错。
4. 平台级玩家正在进入核心能力层。OpenAI、Google Gemini、Apple Intelligence 都已把实时语音翻译做成底层能力；独立 App 不能只拼模型，要拼场景、工作流、数据沉淀和信任。
5. 电话翻译是需求最强的 AI 方向，但也最复杂。iOS/Android 普通 App 不能直接拦截系统电话或微信/WhatsApp 原始音频，竞品常用自有号码、call link、VoIP、会议链接或服务端桥接实现。

## 2. AI 翻译市场规模

| 市场口径 | 公开数据 | 解读 |
| --- | --- | --- |
| AI Language Translator Tool | Precedence Research 估计北美 2025 年 USD 3.35B，2035 年 USD 24.80B，CAGR 22.16%；美国 2025 年 USD 2.51B，2035 年 USD 18.73B | 北美是 AI 翻译商业化核心市场，适合本项目美国/加拿大优先 |
| AI in Language Translation | The Business Research Company 估计 2025 年 USD 2.94B，2026 年 USD 3.68B，2030 年 USD 8.93B，2026 年增长率 25.2% | AI 翻译增速显著高于传统语言服务 |
| Speech-to-Speech Translation | Mordor 估计 2026 年 USD 762M，2031 年 USD 1.25B，CAGR 10.44% | 与实时同传最直接相关，但口径比 AI 翻译整体小 |
| AI App 消费 | Sensor Tower 2026 报告称 AI App 上半年 IAP 收入预计超过 USD 4B，较 2025 下半年增长 36% | 用户对 AI 订阅付费已形成习惯 |

判断：AI 翻译不是一个孤立小类，而是 AI App、通信、会议、教育、跨境商务的一部分。对我们更重要的是垂直场景转化率，而不是泛市场规模数字。

## 3. AI 相关竞品清单

### 3.1 AI 通用翻译工具箱

| 产品 | 当前信号 | AI 卖点 | 定价/商业化 | 对我们的启发 |
| --- | --- | --- | --- | --- |
| Translate Now - AI Translator | 美国 App Store 4.7，353K ratings，Reference #7；Sensor Tower 公开估算近月 500K 下载、USD 3M 收入 | AI translation models、Hands-Free AI Voice Translator、AI Dictionary、Grammar Assistant、Lingo AI、AR Camera、Keyboard | USD 9.99-14.99/周，USD 19.99/月，USD 69.99/年 | AI 包装 + 高价订阅跑通，但偏工具箱；我们应避免功能堆砌，突出同传稳定性 |
| Voice Translator: AI Translate | 美国 App Store 4.4，93K ratings；Sensor Tower 近月 90K 下载、USD 300K 收入 | 100+ 语言、实时语音/文本、相机、离线 | USD 4.99/周、USD 39.99/年等 | 语音翻译有付费空间，但容易被普通翻译工具替代 |
| Translator GO: AI Translate | Sensor Tower 近月 300K 下载、USD 1M 收入 | AI translate、voice/photo/text | 订阅 | 即使不是最大品牌，细分包装也能赚钱 |
| Hi Translate - AI Translator | App Store 描述 137+ 语言、500M+ 用户、Call Translator、AI Meeting Translator、Document/Audio/File、Floating Translator | 低资源语言、实时通话、会议助手、文件/音频翻译、AI 推荐 | 订阅 + Coins | 强调“全球低资源语言”和跨 App，说明垂直定位比语言数量更有用 |
| DeepL | App Store 4.8，13K ratings；Google Play 10M+ downloads | Glossary、Tone、Write、企业安全、行业语言 | USD 10.49/月、USD 104.99/年起 | 术语库和语气控制是高价值 AI 功能，适合 P1/P2 |

### 3.2 AI 电话/视频通话翻译

| 产品 | 当前信号 | AI 能力 | 定价/商业化 | 风险/观察 |
| --- | --- | --- | --- | --- |
| AI Phone: Call & Voice Translator | 美国 App Store 4.7，75K ratings；Google Play 1M+ downloads | 电话翻译、视频/社交 App 翻译、双语字幕、Type-to-Speak、AI Call Summary、Call Transcripts、Listening Mode、Custom Voice Output | USD 8.99/周、USD 14.99/月、USD 59.99/年，另有 credits | 功能非常贴近高价值需求，但用户评论暴露延迟、号码/SMS、客服和计费风险 |
| AI Call - Phone Call Translator | 美国 App Store 4.7，123 ratings | 电话翻译、AI calling agent、视频/语音翻译、call link、live transcripts、face-to-face interpreter | USD 5.99/周，USD 59.99 年项，credits USD 5.99-37.99 | 新产品，但“AI 代打电话/预约客服”是值得关注的高价值方向 |
| Live Interpreter | App Store 描述 150+ 语言、电话/视频实时 AI 翻译 | 无订阅，按分钟翻译 | 10 分钟免费，之后 USD 0.35/min | 按分钟比订阅更贴近通话成本，适合我们未来电话翻译包 |
| VocaLingo | App Store 描述 AI calls、voice cloning、TTS、speech-to-text | 电话翻译 + 语音克隆 | 未完整抓取 | 语音克隆是高吸引力但高风险能力，首版不建议做 |
| AlloCall | App Store 描述 call transcripts、AI call summary、two-way recognition | 电话记录 + 总结 | 未完整抓取 | “通话后总结”已经成为电话翻译标配 |

结论：AI 电话翻译产品的功能组合正在固定为“实时翻译 + 字幕 + 记录 + 总结 + call link/号码 + credits”。但这类产品的用户体验风险也最大：延迟、通话稳定性、计费争议、隐私和平台合规。

### 3.3 AI 会议/课堂/活动同传

| 产品 | 场景 | AI 能力 | 商业模式 | 对我们的启发 |
| --- | --- | --- | --- | --- |
| Wordly | 企业会议、活动、教育、政府、教会 | AI Translation、AI Captions、AI Transcripts、AI Summaries、自动语种选择、speaker disambiguation、后台音频 | 主办方付费，参会者免费 App/浏览器加入；按年度小时包报价 | B2B 会议同传标准答案：字幕、音频、转写、摘要一起卖 |
| JotMe | 会议、电话、现场对话 | 200+ 语言、实时字幕、AI cloned voice、custom dictionary、speaker diarization、meeting notes、Chrome/Desktop/Mobile | 免费试用 + 订阅/团队 | custom dictionary、speaker diarization、跨 Zoom/Meet/Teams 是我们 P1/P2 方向 |
| Felo Translator | 留学、课堂、线下会议 | 实时语音识别、字幕、15 种翻译方向，含简中/繁中到英文 | App 订阅/免费试用 | 更像我们的直接细分竞品，重点对比中英字幕体验 |
| Navi | Apple Vision Pro/iOS 辅助字幕 | 现实世界字幕、设备间字幕共享、翻译 | App/IAP | AR 字幕不是 MVP，但说明“字幕可视化”是长期方向 |
| KUDO | 企业会议和活动 | AI speech translation、合规、会议平台集成 | 企业报价 | 未来企业版要补合规与管理员能力 |

判断：会议/课堂/活动是比旅行翻译更好的 AI 同传市场。用户愿意忍受一定设置成本，只要字幕稳定、可复盘、可导出。

### 3.4 平台级 AI 能力

| 平台 | 能力 | 影响 |
| --- | --- | --- |
| OpenAI Realtime Translation | 专用 realtime translation session，流式输入音频，边说边输出译文音频和 transcript deltas；模型扮演 interpreter，不是普通 assistant | 可作为云端高质量 Provider；适合 POC 和 Pro/Plus 高质量链路 |
| Google Gemini 3.5 Live Translate | Gemini Live API 支持 70+ 语言低延迟 speech-to-speech；连续流式处理；Google 宣称将进入 Google Translate 和 Google Meet | 会直接抬高用户对实时翻译的预期；Android 生态压力更强 |
| Apple Intelligence Live Translation | Messages、Phone、FaceTime、AirPods 上端侧运行，强调隐私；需要 Apple Intelligence 兼容设备和语言包 | 对 iOS 是强平台竞争；我们的优势要避开系统通话原生能力，做跨平台历史/词表/会议沉淀 |
| DeepL AI Platform | 行业语言、Glossary、Tone control、企业安全 | 证明术语库/语气/行业适配是付费理由 |
| T-Mobile Live Translation | 网络层电话实时翻译，无需 App；beta 覆盖 50+ 语言 | 长期会压缩“普通电话翻译 App”空间，但也证明电话翻译需求巨大 |

## 4. AI 功能趋势

1. 实时语音到语音：从“先 ASR 再翻译再 TTS”的拼接链路，走向端到端或专用低延迟 translation session。
2. 字幕 + 音频双输出：会议和电话场景不只要听译音频，还要可扫读字幕。
3. 自动语种识别：竞品和平台都强调不手动切换语言，尤其多语言会议。
4. AI 摘要和 transcripts：同传结束后的复盘价值越来越重要，Wordly、AI Phone、AI Call 都在卖这个。
5. 自定义词典/术语库：JotMe、DeepL 方向清晰，适合专业场景收费。
6. 跨 App 工作流：Translate Now 做键盘，Hi Translate 做 floating translator，AI Phone 做 call link/social app video call。
7. 端侧隐私：Apple 是最强信号。我们当前端侧 ASR 路线是正确的，但要把隐私讲清楚。
8. 计费从订阅扩展到 credits/minutes：电话、视频、云模型成本高，按分钟/credits 更合理。

## 5. AI 能力优先级建议

### MVP 必须强化

| 功能 | 原因 | 当前项目状态 |
| --- | --- | --- |
| 自动语种识别和双向翻译 | AI 同传基本体验；竞品已普遍强调自动检测 | 已做，需要继续稳定快速切换和混合句 |
| 连续实时字幕 | 我们的核心差异点；比普通语音翻译更适合会议/课堂 | 已做，需要继续优化 ASR 断句和自动滚动 |
| 会话历史和导出 | AI 产品的“会后价值”，也是付费理由 | 已做基础闭环 |
| 端侧 ASR 隐私表达 | 对抗 Apple/Google 的唯一可信卖点之一 | iOS 端侧 ASR 已在真机跑通 |
| 无翻译 flush 和长句稳定 | 直接决定真实可用性 | 已修一轮，仍需真机语料回归 |

### P1 高优先级

| 功能 | 价值 | 实现建议 |
| --- | --- | --- |
| AI 会议总结 | 付费感强，能和普通翻译区分 | 先用本地历史文本调用云/本地 LLM，生成双语摘要、要点、待办 |
| 领域词表/ASR 纠错 | 解决当前中文专业词不稳；直接面向商务/医疗/课堂 | 先做本地词典替换，再接 LM Studio/云模型上下文纠错 |
| Speaker/角色标注 | 会议和对话复盘需要 | P1 可先用手动“我/对方”模式，后续做 diarization |
| 翻译质量反馈 | 建立数据闭环 | 每条译文支持标记“不准/漏译/术语错” |
| AI 改写语气 | 类 DeepL Tone，适合商务英文 | 在历史详情页提供“更正式/更口语/更简短” |

### P2/P3

| 功能 | 建议 |
| --- | --- |
| AI Phone/Call Link | 不在 MVP 做原生电话拦截。先做网页 call room 或 App 内语音房间，再评估 CallKit/VoIP |
| AI voice/TTS | 字幕稳定后再做，避免 TTS 延迟拖垮体验 |
| Voice cloning | 暂不做，合规和滥用风险高 |
| AR/眼镜字幕 | 长期方向，不影响当前 App 路线 |
| 多模型自动选择 | Pro 功能，按场景选择端侧/云端/OpenAI/Gemini/本地 LM Studio |

## 6. 推荐 AI 产品定位

建议把产品定位从“翻译软件”升级为：

中英 AI 实时同传助手：自动识别中英文，实时生成双语字幕，会后保存记录、总结和术语纠错，优先端侧处理敏感语音。

英文 App Store subtitle 可考虑：

- AI Chinese-English Interpreter
- Live AI Interpreter for Chinese and English
- Real-time AI Captions & Translation

首发卖点顺序：

1. 中英自动互译，不用手动切换。
2. 连续实时字幕，适合会议、课堂和面对面沟通。
3. 会后保存双语记录，可导出和总结。
4. 支持领域词纠错，专业词更准。
5. 端侧 ASR 优先，隐私更安心。

## 7. 定价调整建议

AI 方向建议采用“订阅 + 分钟/credits”的混合模型：

| 版本 | 建议价格 | 权益 |
| --- | --- | --- |
| Free | 免费 | 每月 30 分钟端侧中英同传，历史 3 条，不能 AI 总结 |
| Pro | USD 9.99/月，USD 59.99/年 | 600-1000 分钟同传，历史不限，导出，AI 摘要每月 30 次，领域词表 100 个 |
| Plus | USD 14.99/月，USD 99.99/年 | 更高分钟数，云端高质量 Provider，AI 纠错，更多摘要，跨设备同步 |
| Call/Cloud Credits | USD 5.99/100 credits 起 | 未来电话/视频/高质量云模型按量扣费 |

理由：AI Phone 和 AI Call 已经证明订阅 + credits 可接受；但我们首版还在建立信任，不宜直接做高压周订阅。

## 8. 对当前技术路线的影响

1. Provider Router 必须保留。OpenAI/Gemini/本地 LM Studio/端侧系统翻译都会变化，业务层不能绑定单模型。
2. iOS 端侧 ASR 是正确护城河，但不能只靠端侧。高质量 AI 总结、纠错、术语解释需要云端或本地 LLM Provider。
3. Flutter 跨平台路线继续正确。AI 竞品普遍跨 iOS/Android/桌面/插件，未来我们也需要桌面会议助手。
4. 历史记录要升级为产品资产。后续 AI 摘要、词表、纠错、复盘都依赖历史数据结构。
5. 电话翻译先不碰系统电话拦截。可先做 App 内 call room/call link，验证真实需求后再做 CallKit/VoIP。

## 9. 下一步抓取和实测任务

1. 安装并实测 AI Phone、AI Call、Translate Now、Felo、JotMe、Wordly attendee app，记录启动路径、延迟、断句、字幕稳定性、是否保存历史。
2. 用同一套中英测试语料横测：普通短句、长句、快速中英切换、商务词、医疗词、课堂句子、噪声环境。
3. 抓 App Store 订阅页面截图，记录是否有试用、是否周订阅默认选中、用户差评集中在哪些点。
4. 做 AI 总结 POC：把当前历史记录发给 LM Studio/OpenAI，生成中文摘要、英文摘要、行动项和术语纠错建议。
5. 做领域词表 MVP：先支持用户输入词条，例如“同声传译、端侧翻译、字幕、实时识别”，ASR 后处理优先替换。

## 10. 资料来源

- Apple App Store: Translate Now - AI Translator, https://apps.apple.com/us/app/translate-now-ai-translator/id1348028646
- Apple App Store: AI Phone: Call & Voice Translator, https://apps.apple.com/us/app/ai-phone-call-voice-translator/id6465173251
- Apple App Store: AI Call - Phone Call Translator, https://apps.apple.com/us/app/ai-call-phone-call-translator/id6744344005
- Apple App Store: Hi Translate - AI Translator, https://apps.apple.com/us/app/hi-translate-ai-translator/id6744311749
- Apple App Store: Voice Translator: AI Translate, https://apps.apple.com/us/app/voice-translator-ai-translate/id1036725690
- Apple App Store: Felo Translator, https://apps.apple.com/us/app/felo-translator/id6447256759
- Apple App Store: Navi - Subtitles & Translation, https://apps.apple.com/us/app/navi-subtitles-translation/id1573261774
- Google Play: AI Phone, https://play.google.com/store/apps/details?id=com.aiphone.secondphonenumber
- Google Play: Translate AI - Live Translate, https://play.google.com/store/apps/details?id=co.appnation.aivoicetranslator
- JotMe, https://www.jotme.io/
- Wordly Translation App, https://www.wordly.ai/translation-app
- Wordly Pricing, https://www.wordly.ai/pricing
- Felo Translator, https://felo.me/en/translator
- OpenAI Realtime Translation, https://developers.openai.com/api/docs/guides/realtime-translation
- Google Gemini Live Translation API, https://ai.google.dev/gemini-api/docs/live-api/live-translate
- Apple Support: Live Translation on iPhone, https://support.apple.com/en-us/123720
- DeepL AI Platform, https://www.deepl.com/en
- Sensor Tower public overview pages, https://app.sensortower.com/
- Precedence Research: AI Language Translator Tool Market, https://www.precedenceresearch.com/ai-language-translator-tool-market
- Mordor Intelligence: Speech to Speech Translation Market, https://www.mordorintelligence.com/industry-reports/speech-to-speech-translation
- The Business Research Company: AI In Language Translation Market, https://www.thebusinessresearchcompany.com/report/ai-in-language-translation-global-market-report
