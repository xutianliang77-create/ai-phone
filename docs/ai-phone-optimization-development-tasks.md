# ai phone 优化开发任务清单

版本：v2.9
日期：2026-07-12
关联：`docs/domestic-app-detailed-functional-design.md`、`docs/ai-phone-translation-technical-design.md`、`docs/domestic-design-review-action-plan.md`

## 1. 目标和范围

本清单落实已确认的产品、技术和 UI 优化方案。当前 Flutter + Node/TypeScript + Python + LiveKit 架构继续保留，不在 P0/P1 重写客户端或拆分 Go 微服务。

优先顺序：

1. 先完成说话人驱动 ASR 分句、实时稳定性和发布级 UI。
2. 再完成 speaker-turn 翻译、纪要、术语、Call Link 和生产数据基础。
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
| OPT-VAD-001 | 服务器 MarbleNet 主 VAD | VAD Provider、ONNX 运行时、固定预处理资产、RMS 降级 | 无 | 低音量可检出，静音和三档非语音噪声不触发，真实在线链路可转写 |
| OPT-VAD-002 | VAD 观测和故障诊断 | session 指标、fallback 告警、模型 fingerprint、端点原因 | OPT-VAD-001 | 可按 session 判断实际 Provider、概率摘要、fallback 和端点原因；后续由 OPT-OBS-001 汇总 |
| OPT-VAD-003 | 模式化端点策略 | 对话、聆听、Call Link、PSTN 参数配置和回归语料 | OPT-VAD-001、OPT-RT-003 | 各模式断句和延迟达标，可独立回退统一 1100ms 基线 |
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

- `OPT-VAD-001`：`accepted`。Beelink 已上线 MarbleNet ONNX CPU 主 VAD，阈值 0.5；NeMo/ONNX 概率最大误差 `2.38e-7`，低音量真机语音、静音和三档非语音噪声及真实 HTTP ASR 均通过。
- `OPT-VAD-002`：`in_progress`。部署后的真实 session 已保存 `speaker_boundary/flush` 端点原因和音频丢帧计数；尚缺 VAD 概率摘要、fallback 计数、模型 fingerprint 和告警。
- `OPT-VAD-003`：`todo`。当前继续使用 Qwen3-ASR 统一 `1100ms` 安全基线，尚未启用按模式参数。
- `OPT-RT-001`：代码和自动化门禁完成。
- `OPT-RT-002`：代码和自动化门禁完成；连接中的 HTTP 创建请求不再阻塞本地 End，API 创建/保存/结束统一 8 秒超时，迟到 session 会补偿关闭。iPhone 断网 End 已确认立即进入本地终态；原始 `TimeoutException` 暴露问题已修为“本地结束、历史同步未确认”，新 Profile 文案复验、后台终止和弱网验收待执行。
- `OPT-RT-003`：代码和自动化门禁完成；iPhone 在线真实模型中文长句、快速中英切换和 1.8 秒强制输出验收待执行。
- `OPT-RT-004`：代码和自动化门禁完成；iPhone 在线真实模型“说完立即结束”及 100 次尾句保存率验收待执行。
- `OPT-RT-005`：代码和自动化门禁完成；Gateway 按字幕顺序逐条合成，暂停、结束和断线取消在途及待处理 TTS，App 顺序播放并清空残留。iPhone + VoxCPM2 连续 20 句真实听感验收待执行。
- `OPT-MOB-001`：代码和自动化门禁完成；iOS/Android 使用统一采集/播放所有权，系统中断结束后恢复在线录音或端侧 ASR，Android TTS/PCM 只在真实播放结束后完成。iPhone/Android 真机中断、耳机和连续朗读验收待执行。
- `OPT-MOB-002`：代码和自动化门禁完成；扬声器、听筒和未知路由在 TTS 播放期间及 350ms 尾音窗抑制采集，有线/蓝牙耳机保持连续识别，Listening 强制静音但保留对话模式声音偏好。iPhone/Android 连续 20 句、自激和下一句完整性验收待执行。
- `OPT-UI-001`：代码和自动化门禁完成；`idle/connecting/active/paused/ending/ended/failed` 只展示当前可执行操作，主操作固定在同一槽位，连接中可取消且迟到 session 不会恢复同传。iPhone/Android 真机布局与点击体验验收待执行。
- `OPT-UI-002`：代码和自动化门禁完成；字幕区移除固定 420dp 高度并占满剩余空间，最后一段标记当前句，译文 final 前显示 pending，动态高度字幕可自动跟随并在用户上滑后提供回到底部。iPhone/Android 真机小屏、横屏和 200% 字体验收待执行。
- `OPT-SPK-001`：统一 contract、Call Link participant track、Session Repository、字幕、历史、review 和导出代码完成；真实双端角色归属验收待执行。
- `OPT-SPK-002`：Streaming Sortformer 已在 Beelink 以正式 `provider=sortformer/mode=active` 部署，HTTP Provider、ASR 并行旁路、时间对齐、故障降级和固定双声源测试通过；抢话、重叠、四人和正式真人 RTTM 门禁仍待执行。
- `OPT-SPK-003`：ASR 后置 speaker 对齐、不同 speaker 段禁止合并、字幕标签、历史清单和会话内重命名代码完成，iPhone 已能显示匿名“说话人 1/2”；ASR 段内部按 speaker 切分由 `OPT-SPK-005/006` 负责。
- `OPT-SPK-005`：`accepted`。Gateway 和 Beelink ASR/Speaker Service 已部署；Gateway 对旧 token 或缺失字段强制补齐 `auto + maxSpeakers=4`，Speaker Provider 启用状态、配置来源和失败可观测；稳定 speaker span 可产生单次 `boundaryMs`，标签抖动、低置信度和 overlap 不切段。固定双声源会话和 iPhone 真人双人无停顿轮流说话均正确显示“说话人 1/2”，且句子未跨说话人合并。
- `OPT-SPK-006`：`in_progress`。已修复 Gateway 合并批次错误使用末帧时间的问题；ASR boundary API 已通过真实 PCM 回切，左右段时间轴连续、右侧音频保留且 VAD 不重置。2秒脱敏诊断窗口、boundary hit/miss/error、确认延迟、回切时长、endpoint race 和丢帧指标已贯通 `session.ended`、API 与历史详情。部署后固定双声源 session 为 hit=1、miss/error/race/drop=0、确认延迟1040ms；iPhone 快速换人验收待完成。
- `OPT-SPK-007`：`in_progress`。`turnId + revision` 已贯通 ASR、Gateway 事件、API session、Flutter 字幕和历史；不同 turn 禁止语义合并，批量 ASR 结果按音频时间排序，同 segment 只处理最高 revision。迟到的旧 revision 可补译文，但不能回滚说话人、时间轴、原文或稳定 turn。API/Gateway 已部署，固定双声源真实 session 正确保存 `turn_1/turn_2`；iPhone 双人/多人验收待完成。
- `OPT-SPK-008`：`in_progress`。App、API 和 Speaker Service 默认人数已统一为4；turn 语言画像、同 segment revision 原位更新、overlap/unknown 保护边界、App 可见状态和历史/导出已贯通并部署。固定双声源会话已保存中英文 dominant language；2至4人、抢话、重叠和混合句真机联合验收待执行。
- `OPT-DEP-001`：`in_progress`。模型服务已在 Beelink，当前 API/Gateway 仍使用 Mac 测试节点；该拓扑只用于本轮验收，不满足正式“服务器 + 手机”退出条件。
- `OPT-DEP-002`：`todo`。待把 API、Gateway、Worker、LiveKit 和模型服务纳入 Beelink 单一发布单元。
- `OPT-DEP-003`：`in_progress`。App 已不直连模型端口，但仍指向临时 Mac API/Gateway 地址；服务器统一部署后改为唯一公开入口并复验。

### 2.1 当前冲刺任务拆分

| 子任务 | 工作内容 | 预计工作量 | 当前状态 | 验收证据 |
| --- | --- | ---: | --- | --- |
| SPK-005-A | iPhone 双人无停顿快速换人 | 已完成 | accepted | 真人真机正确显示“说话人 1/2”，切换 speaker 时正确断句、不跨人合并 |
| SPK-005-B | Speaker Provider 启用和容错 | 已完成 | deployed | Gateway 缺省配置兜底、2秒推理超时、失败日志、重复/乱序帧幂等；固定双声源产生两个 turn |
| SPK-006-0 | 批量音频时间轴修复 | 已完成 | accepted | 合并帧保留首帧 `timestampMs` 和末帧 sequence，自动化覆盖 |
| SPK-006-A | 2秒脱敏诊断窗口 | 0.5天 | in_progress | 元数据窗口和白名单持久化已通过真实 session；iPhone/断网复验待执行 |
| SPK-006-B | boundary 指标 | 0.5天 | in_progress | 真实 session 已保存 hit=1、miss/error=0、1040ms、4240ms回切、drop=0 和 endpoint reason；多人样本待执行 |
| SPK-006-C | boundary 与普通端点竞态 | 1天 | in_progress | 有替代结果时去重、空结果时保留原文；固定双声源 race=0，仍需真机短停顿构造竞态 |
| SPK-007-A | turn 数据契约 | 已完成 | deployed | segment 持久化 `turnId`、`revision`、`speakerId` 和原始时间范围；真实历史验证通过 |
| SPK-007-B | 有序翻译队列 | 已完成 | deployed | 批量结果按音频时间排序，不跨 turn 合并；固定双声源事件和历史顺序一致 |
| SPK-008-A | 多人/混合语种验收 | 1-2天 | in_progress | 代码、自动化和固定双声源已通过；2至4人、抢话、重叠、中英夹杂和 unknown 真机待验收 |
| DEP-001-A | Gateway/API 迁入 Beelink | 1天 | todo | 停止 Mac 服务后 iPhone 在线同传、历史和结算仍正常 |

当前关键路径：`断网 End 新文案复验 -> SPK-008-A 多人/重叠/混合语种 -> DEP-001-A`。固定双声源、API/Gateway/Speaker active 部署、iPhone 双人快速换人和本地断网结束均已验证；`OPT-SPK-006/007/008` 仍需各自剩余真人证据后才能标记 `accepted`。

## 3. P1 灰度任务

| 编号 | 任务 | 主要交付物 | 依赖 | 完成定义 |
| --- | --- | --- | --- | --- |
| OPT-LLM-001 | LLM 实时纠错边界 | no-thinking、JSON schema、超时回退 | OPT-RT-003 | 思考过程不污染字幕，超时使用原文 |
| OPT-LLM-002 | segment 三文本结构 | raw、merged/optimized、translated 和诊断字段 | OPT-LLM-001 | 历史可追溯原始识别、优化和译文 |
| OPT-LLM-003 | 结构化会后 review | 摘要、决定、待办、事实、风险、问题、证据 | OPT-LLM-002 | API 输出可校验 JSON，结论可回溯 segment |
| OPT-UI-006 | 历史与纪要重构 | AI 标题、日期、时长、语言、摘要、四视图 | OPT-LLM-003 | 用户可在两步内查看纪要、全文和术语 |
| OPT-TERM-001 | 行业和术语选择 | 商业、科技、医疗、旅游、餐饮、娱乐 | OPT-LLM-002 | App 选择行业后 ASR 热词、翻译术语、LLM 保护字段生效 |
| OPT-SPK-001 | 说话人统一数据契约 | speaker id、角色、标签、来源和置信度贯通字幕、历史、导出、review | OPT-RT-003 | Call Link 独立音轨可准确显示我/对方，普通同传兼容匿名 speaker |
| OPT-SPK-002 | 流式说话人分离 Provider | 独立 harness、Streaming Sortformer 评测、时间区间输出 | OPT-SPK-001 | 双人和多人固定语料达到 DER、切换延迟和标签稳定性门槛 |
| OPT-SPK-003 | 普通同传说话人归属 | 音频/ASR 后置时间对齐、不同 speaker 段禁止合并、App 标签和重命名 | OPT-SPK-002 | 已分开的 ASR 段稳定归属说话人，不跨 speaker 再合并文本 |
| OPT-SPK-005 | SpeechTurnCoordinator | participant、VAD、speaker span 边界优先级和防抖状态机 | OPT-SPK-002、OPT-VAD-001 | 确认换人可产生稳定 `boundaryMs`，标签抖动不切碎字幕 |
| OPT-SPK-006 | 说话人驱动 ASR Turn Buffer | 2秒 PCM 环形缓冲、按边界回切、连续 VAD 与 turn 状态分离 | OPT-SPK-005 | 快速换人不进入同一 ASR 段，切 turn 不重置连续 VAD |
| OPT-SPK-007 | Speaker-turn 翻译队列 | `turnId + revision`、同 speaker 语义合并、上下文翻译和有序输出 | OPT-SPK-006、OPT-LLM-001 | 不跨 speaker 拼接翻译，返回顺序与音频时间轴一致 |
| OPT-SPK-008 | 多人和混合语种策略 | 默认4人、overlap、unknown、revision、dominant/mixed language | OPT-SPK-005 | 对话和聆听不限定2人，中英混说不触发硬断点或 speaker 切换 |
| OPT-CALL-001 | Call Link 真人双端闭环 | Host、Guest、Worker、字幕、译音、历史 | OPT-RT-003、OPT-RT-005、OPT-MOB-001 | 双端连续 30 分钟，无乱序和不可恢复断线 |
| OPT-CALL-002 | 通话页产品分层 | 核心入口、实验入口、不可用能力隐藏 | OPT-UI-004 | 首屏不展示不可用 PSTN 为主要操作 |
| OPT-SCAN-001 | 扫描流程重构 | 图片预览、识别、翻译、保存、分享渐进流程 | OPT-UI-004 | 未选择图片时不展示无效二级操作 |
| OPT-DATA-001 | SQLite WAL Repository | account、session、segment、usage、terms、outbox | OPT-RT-002、OPT-LLM-002 | 事务、外键、幂等和 quick_check 通过 |
| OPT-DATA-002 | SQLite 备份与恢复 | 一致性快照、对象目录批次、损坏阻断 | OPT-DATA-001 | 恢复后 session、ledger 和对象 hash 一致 |
| OPT-OBS-001 | 体验指标和诊断 | latency、drop、fallback、provider fingerprint | OPT-RT-001 | 每个 session 可生成完整质量报告且日志脱敏 |
| OPT-VAD-004 | VAD 时间轴与说话人/记录贯通 | segment 保存 speech 起止、端点原因和 VAD fingerprint | OPT-VAD-002、OPT-SPK-003 | 字幕、说话人、历史和 review 使用同一语音时间轴，不持久化 20ms 原始概率 |

## 4. P2/P3 增强任务

| 编号 | 任务 | 完成定义 |
| --- | --- | --- |
| OPT-S2S-001 | 新增 `SpeechToSpeechProvider` 能力契约 | 原生语音模型可与级联路线并存并可灰度切换 |
| OPT-S2S-002 | Gemini Live 国际路线 | 固定语料通过质量、成本、地区和隐私评审 |
| OPT-S2S-003 | GPT-Live 候选接入 | API 正式可用后通过 Provider 评测再上线 |
| OPT-PSTN-001 | 真实 PSTN 服务商媒体协议 | 普通电话接通、译音回灌、失败退款闭环 |
| OPT-AGENT-001 | AI Calling Agent 灰度 | 授权、告知、人工接管、禁拨和风险场景通过验收 |
| OPT-VOICE-001 | VoxCPM2 Hi-Fi 声音克隆 | 录音质量检查、A/B 试听、自然度门禁通过 |
| OPT-SPK-004 | 授权声纹身份识别 | 声纹注册、置信度门禁、撤回、删除和匿名回退 |
| OPT-ANDROID-001 | Android 端侧 ASR 候选 | 与系统 ASR、在线 ASR 固定语料对比后决策 |
| OPT-VAD-005 | 端侧 MarbleNet 候选评测 | CoreML/Android ONNX 与现有端点检测比较低音量召回、误触发、耗电、温升和实时系数，通过后再决定是否集成 |
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
