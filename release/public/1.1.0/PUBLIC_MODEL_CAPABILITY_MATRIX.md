# 公共模型协议能力矩阵（第77批）

本表描述当前源码适配范围，不是供应商全量产品目录、模型质量或生产可用性证明。模型/Voice/地域仍由管理员手填；本地模式使用手机模型，在线模式使用公共ASR/翻译及开启的TTS。没有增加第三种模式。

## 协议与音频参数

| 组件/供应商 | 协议ID | 已实现输入/输出 | PCM采样率 |
|---|---|---|---|
| ASR/Qwen | qwen_asr_realtime | WS连续PCM，增量及最终字幕 | 16k |
| ASR/Qwen | qwen_asr_compatible | HTTPS完整WAV片段内联，完整转写；非Filetrans | 16k/24k |
| ASR/腾讯 | tencent_asr_ws | WS连续PCM，分段识别；每应用端点新流 | 16k |
| ASR/OpenAI | openai_realtime_asr | WS连续PCM，增量及最终字幕 | 24k |
| ASR/OpenAI | openai_transcriptions | HTTPS multipart完整片段，完整转写 | 16k/24k |
| ASR/Google | google_speech_v2 | 双向gRPC连续PCM，增量及最终字幕 | 16k/24k |
| 翻译/Qwen | qwen_chat | HTTPS Chat Completions，完整文本结果 | 不适用 |
| 翻译/腾讯 | tencent_hunyuan_chat | HTTPS兼容Chat，完整文本结果 | 不适用 |
| 翻译/OpenAI | openai_chat | HTTPS Chat Completions，完整文本结果 | 不适用 |
| 翻译/Google | google_gemini | HTTPS generateContent，完整文本结果 | 不适用 |
| 翻译/Google | google_vertex_gemini | HTTPS Vertex generateContent，完整文本结果 | 不适用 |
| TTS/Qwen | qwen_tts_realtime | 文本提交，WS音频分块输出 | 24k |
| TTS/腾讯 | tencent_tts_ws | 文本提交，签名WS音频分块输出 | 16k/24k |
| TTS/OpenAI | openai_speech | 文本提交，HTTP PCM分块消费 | 24k |
| TTS/Google | google_cloud_tts | 文本提交，HTTPS整段WAV返回，严格去头后播放 | 16k/24k |

ASR统一单应用段最多30秒，这是当前实现的保护上限，不是服务商最大录音时长。完整片段入口不能作为连续会话ASR，原联合装配在任何凭据/网络回调之前拒绝该组合。TTS每段最多4096码点；Google还限UTF-8 5000字节。音频分块传输不等于供应商低延迟已实测。

## 语言、声音和认证

- Qwen ASR：明确源语言，当前源码支持产品语种交集21项；不将文字语种观察冒充声学自动识别。Qwen TTS显式映射zh/en/de/it/pt/es/ja/ko/fr/ru。
- 腾讯ASR：语言必须匹配已实现的16k引擎类型；TTS目前仅明确zh/en，声音使用手填VoiceType，不支持SSML/复刻。
- OpenAI ASR：当前显式两字母产品源语言；TTS的具体Voice/模型语言能力另验，不由HTTP成功推断正确发音。
- Google ASR：源语言经管理员languageLocales映射，项目/地域/Recognizer/model一致；TTS命名Voice的locale须匹配目标语言。
- 翻译按实际明确语言对传参；完整公共音频会话的自动语言/反向仍未取得资格。单组件支持不代表联合自动路由完成。
- Qwen/OpenAI/腾讯混元兼容Chat及Gemini使用API Key；腾讯语音使用SecretId/SecretKey与AppId；Google语音/Vertex复用服务账号或显式ADC。秘密不进入手机、Token、能力目录或可回读配置。

## 单一约束源与兼容

`packages/contracts/src/realtime/public-model-capabilities.ts`保存实现约束；原API目录/配置页面、保存校验和Gateway原ASR/TTS/联合装配共用采样率与输入类型定义。现有wire仍保留具体模型/语种/Voice和协议应答校验，不以目录替代实际校验。

新配置默认选该协议支持的采样率；旧的不兼容值仍原样显示并标注“需修改”，不在加载页面时自动改写。启用并保存不支持的采样率返回错误；旧密文仍可读取、修正后按revision保存，不迁移现有配置。朗读关闭的会话不依赖未使用TTS的采样率，也不改写原TTS配置。

私有配置页面仍使用自身协议规则，不套用公共采样率限制。无权重下载，无自动重采样，没有私有模型fallback。

## 生产入口与退出门禁

现有内部组件/原API合成旅程已实现，但以下事实不能混为一谈：已配置、适配代码存在、真实模型资格通过、会话授权通过、生产入口可运行。

当前后三层未整体通过。`realtimeCreationBlocker`、`ProviderRouter.selectProvider`和公共readiness的生产保护保持，配置页不调用模型。下一切片是原公有创建/准入协调、captureSampleRate及Token发行和Gateway受控装配；必须复用已有绑定/证据/lease/记账，不能用客户端声明或测试夹具授予真实资格。

历史安全告警另行审阅，不因本矩阵通过而豁免；正式发版还需同一RC完成真实模型、手机、容量/恢复与原功能/优化验收。
