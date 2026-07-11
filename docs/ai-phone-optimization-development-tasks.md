# ai phone 优化开发任务清单

版本：v1.1
日期：2026-07-11  
关联：`docs/domestic-app-detailed-functional-design.md`、`docs/ai-phone-translation-technical-design.md`、`docs/domestic-design-review-action-plan.md`

## 1. 目标和范围

本清单落实已确认的产品、技术和 UI 优化方案。当前 Flutter + Node/TypeScript + Python + LiveKit 架构继续保留，不在 P0/P1 重写客户端或拆分 Go 微服务。

优先顺序：

1. 先修实时稳定性和发布级 UI。
2. 再完成纪要、术语、Call Link 和生产数据基础。
3. 最后开发原生语音 Provider、PSTN、AI Agent 和声音克隆增强。

模型实验、ASR/TTS 横评和真机诊断默认使用独立 harness；只有明确进入正式集成和验收时才修改或编译生产 App。

## 2. P0 发布前任务

| 编号 | 任务 | 主要交付物 | 依赖 | 完成定义 |
| --- | --- | --- | --- | --- |
| OPT-RT-001 | 统一 realtime session 状态机 | `idle` 到 `ended/failed` 的状态转换、幂等命令 | 无 | App、Gateway、API 对开始/暂停/恢复/结束状态口径一致 |
| OPT-RT-002 | 异常断开 finalize | close/error 路径 flush、保存、结算 | OPT-RT-001 | 断网、杀进程、重复 End 均只结算一次，历史可打开 |
| OPT-RT-003 | SegmentAssembler | partial/final、合并窗口、端点、去重、强制输出 | 无 | 被中间切断的句子可合并，超时不会长期无字幕 |
| OPT-RT-004 | 最后一句 flush 加固 | App、Gateway、ASR flush 统一协议 | OPT-RT-001、OPT-RT-003 | 结束后无正常段落只有原文没有译文 |
| OPT-RT-005 | 在线 TTS 顺序队列 | session/segment 队列、取消、超时、失败降级 | OPT-RT-001 | 连续 20 句字幕和朗读顺序一致，结束后无残留播放 |
| OPT-MOB-001 | AudioSessionCoordinator | iOS/Android 采集、播放、耳机、中断统一协调 | OPT-RT-001 | TTS 播放后 ASR 自动恢复，平台插件不争抢音频会话 |
| OPT-MOB-002 | 回声和播放策略 | 扬声器抑制窗、耳机连续识别、Listening 默认静音 | OPT-MOB-001、OPT-RT-005 | 朗读 20 句不自激、不吞下一句 |
| OPT-UI-001 | 状态化同传控制栏 | 开始、取消、暂停、继续、结束、再次开始 | OPT-RT-001 | 每个状态只显示当前可执行操作，无无效按钮 |
| OPT-UI-002 | 弹性字幕工作区 | 去除固定高度、当前句、pending、自动跟随 | OPT-RT-003 | 320dp、小屏、横屏和 200% 字体无溢出 |
| OPT-UI-003 | 同传设置弹层优化 | 模式、处理、语言、声音四组设置 | OPT-RT-001 | 设置锁定时显示原因和“结束后修改”动作 |
| OPT-UI-004 | 设计系统和可访问性 | 颜色、字号、间距、按钮、状态色、深色模式 | 无 | 主要页面视觉一致，VoiceOver/TalkBack 可读核心操作 |
| OPT-UI-005 | 真实发布截图链路 | 真 App、中文字体、iOS/Android 独立截图 | OPT-UI-001 至 004 | 无方框字、无 Debug 标识，素材来自真实页面 |
| OPT-SEC-001 | 声音 reference 归属校验 | 服务端上传后置 ready、用户归属验证 | 无 | 伪造或复用他人 reference id 被拒绝 |
| OPT-SEC-002 | realtime token 安全传输 | 一次性 token 或 subprotocol，旧模式灰度 | OPT-RT-001 | URL 和访问日志中不出现原始 token |
| OPT-REL-001 | 源码与 dist 一致性门禁 | build 校验、发布脚本阻断脏产物 | 无 | 源码变更未 build 时发布门禁失败 |
| OPT-IOS-001 | 修复安装后闪退流程 | Profile/Release 安装脚本、Debug 产物阻断 | 无 | 独立启动不依赖 Flutter tooling 或 Xcode |
| OPT-IOS-002 | 启动崩溃证据门禁 | 崩溃日志归档、启动 20 次回归 | OPT-IOS-001 | 20 次桌面冷启动无退出，无新 crash report |
| OPT-DEP-001 | 服务器+手机两层拓扑 | 统一服务器基地址、删除 Mac 运行依赖 | 无 | 停止 Mac 服务后在线链路仍正常 |
| OPT-DEP-002 | 单服务器发布单元 | API、Gateway、Worker、LiveKit、模型、数据统一部署 | OPT-DEP-001 | 一份 server.env 可启动和检查全部服务器组件 |
| OPT-DEP-003 | 手机配置边界门禁 | App 只持有服务器公开地址 | OPT-DEP-001 | App 配置无 Mac IP、模型端口和内部密钥 |

当前实现状态：

- `OPT-RT-001`：代码和自动化门禁完成。
- `OPT-RT-002`：代码和自动化门禁完成；iPhone 飞行模式、后台终止和弱网真机验收待执行。

## 3. P1 灰度任务

| 编号 | 任务 | 主要交付物 | 依赖 | 完成定义 |
| --- | --- | --- | --- | --- |
| OPT-LLM-001 | LLM 实时纠错边界 | no-thinking、JSON schema、超时回退 | OPT-RT-003 | 思考过程不污染字幕，超时使用原文 |
| OPT-LLM-002 | segment 三文本结构 | raw、merged/optimized、translated 和诊断字段 | OPT-LLM-001 | 历史可追溯原始识别、优化和译文 |
| OPT-LLM-003 | 结构化会后 review | 摘要、决定、待办、事实、风险、问题、证据 | OPT-LLM-002 | API 输出可校验 JSON，结论可回溯 segment |
| OPT-UI-006 | 历史与纪要重构 | AI 标题、日期、时长、语言、摘要、四视图 | OPT-LLM-003 | 用户可在两步内查看纪要、全文和术语 |
| OPT-TERM-001 | 行业和术语选择 | 商业、科技、医疗、旅游、餐饮、娱乐 | OPT-LLM-002 | App 选择行业后 ASR 热词、翻译术语、LLM 保护字段生效 |
| OPT-CALL-001 | Call Link 真人双端闭环 | Host、Guest、Worker、字幕、译音、历史 | OPT-RT-003、OPT-RT-005、OPT-MOB-001 | 双端连续 30 分钟，无乱序和不可恢复断线 |
| OPT-CALL-002 | 通话页产品分层 | 核心入口、实验入口、不可用能力隐藏 | OPT-UI-004 | 首屏不展示不可用 PSTN 为主要操作 |
| OPT-SCAN-001 | 扫描流程重构 | 图片预览、识别、翻译、保存、分享渐进流程 | OPT-UI-004 | 未选择图片时不展示无效二级操作 |
| OPT-DATA-001 | SQLite WAL Repository | account、session、segment、usage、terms、outbox | OPT-RT-002、OPT-LLM-002 | 事务、外键、幂等和 quick_check 通过 |
| OPT-DATA-002 | SQLite 备份与恢复 | 一致性快照、对象目录批次、损坏阻断 | OPT-DATA-001 | 恢复后 session、ledger 和对象 hash 一致 |
| OPT-OBS-001 | 体验指标和诊断 | latency、drop、fallback、provider fingerprint | OPT-RT-001 | 每个 session 可生成完整质量报告且日志脱敏 |

## 4. P2/P3 增强任务

| 编号 | 任务 | 完成定义 |
| --- | --- | --- |
| OPT-S2S-001 | 新增 `SpeechToSpeechProvider` 能力契约 | 原生语音模型可与级联路线并存并可灰度切换 |
| OPT-S2S-002 | Gemini Live 国际路线 | 固定语料通过质量、成本、地区和隐私评审 |
| OPT-S2S-003 | GPT-Live 候选接入 | API 正式可用后通过 Provider 评测再上线 |
| OPT-PSTN-001 | 真实 PSTN 服务商媒体协议 | 普通电话接通、译音回灌、失败退款闭环 |
| OPT-AGENT-001 | AI Calling Agent 灰度 | 授权、告知、人工接管、禁拨和风险场景通过验收 |
| OPT-VOICE-001 | VoxCPM2 Hi-Fi 声音克隆 | 录音质量检查、A/B 试听、自然度门禁通过 |
| OPT-ANDROID-001 | Android 端侧 ASR 候选 | 与系统 ASR、在线 ASR 固定语料对比后决策 |
| OPT-DATA-003 | PostgreSQL/Redis 后续迁移 | Repository adapter 可迁移，数据校验和回滚通过 |

## 5. Definition of Done

每个任务只有同时满足以下条件才可标记完成：

- 代码按现有模块边界拆分，无新增超大文件。
- 单元测试和相关集成测试通过。
- 错误、空状态、重试和取消路径已覆盖。
- 用户可见文本完成中英文资源化，不新增硬编码界面文案。
- 日志不包含 token、手机号、参考音频内容等敏感数据。
- 文档、配置示例和发布门禁同步更新。
- 需要真机或真实模型证明的任务必须附验收证据，不能只以 mock 测试完成结项。
