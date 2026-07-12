# ai phone 优化开发任务清单

版本：v4.1
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
- `OPT-VAD-002`：`in_progress（代码完成，统一验收待执行）`。VAD Provider 已输出配置/实际 Provider、概率摘要、speech ratio、fallback 次数/原因和模型 fingerprint；Gateway 在结束前按 session 拉取，API 仅白名单保存脱敏诊断。尚未部署到 Beelink 做故障注入复验，完成前不标记 accepted。
- `OPT-VAD-003`：`in_progress（代码完成，统一验收待执行）`。会话模式已通过 token 进入 Gateway/ASR；App 对话与聆听分别映射 `conversation/listening`，LiveKit 与 PSTN Worker 分别固定 `call_link/pstn`。ASR 首帧冻结 session 策略并拒绝中途改模式；默认端点静音为 900/1400/900/1100ms。尚未部署和执行四模式固定语料门禁。
- `OPT-VAD-004`：`in_progress（代码完成，统一验收待执行）`。final segment 已贯通 `timing + speaker + vadContext`；历史、本地 finalization outbox、Markdown/CSV 导出和远端 review 使用同一 speech 区间、端点原因及模型/策略 fingerprint，不持久化逐帧概率或 PCM。
- `OPT-RT-001`：代码和自动化门禁完成。
- `OPT-RT-002`：`accepted`。App 结束前持久化按 `sessionId` 隔离的 finalization outbox，网络恢复、冷启动和回前台会重试保存与结束；API 校验路径 ID、请求体 ID、账号和幂等键，并对同一 session 串行、不同 session 并行结算。iPhone 断网复验 session `7a576a03-d139-4e42-a473-bb0ee13fb63a` 自动收敛 ended，2段字幕完整、hold=0、仅一条 `-21` 秒 ledger，未暴露原始超时。
- `OPT-RT-003`：`accepted`。RT-003B 三轮 silence 断句及翻译延迟通过；RT-003A 已禁止 `max_duration` 硬切段使用上下文 LLM、拒绝超出 raw 支持范围的扩写，并按 raw continuation 合并。Qwen3 ASR 去重现仅作用于时间重叠结果，重复讲话不会再被误删；动态纠错 context 回显在 ASR Provider 入口拦截。iPhone session `c7c915b7-d5d2-4ab0-9e3d-58f52adb92ad` 三轮同句产生3段译文，无未来后缀扩写、重复后缀或领域词泄露，427帧零丢失、hold=0、单次结算。
- `OPT-RT-004`：`todo（可靠性验收）`。代码和自动化门禁完成，RT-004A“说完立即结束”和 RT-004B“翻译处理中立即结束”冒烟通过；100 次尾句原文和译文保存率尚未执行，完成前不得标记 accepted。
- `OPT-RT-005`：`accepted`。Gateway 按字幕顺序逐条合成，暂停、结束和断线取消在途及待处理 TTS，App 顺序播放并清空残留。VoxCPM2 已修复48k误标24k、正文控制提示泄露和自然声音音量过低；自然声音与当前个人克隆均达到约 `-18 dBFS`、ASR 回听只有正文。iPhone 两轮真机验收通过：长测 session `99812932-3d12-4675-bc00-b1ae87a65e3f` 连续19段、结束/取消 session `c9251e1b-8cca-45db-bdf5-12766ab2d016` 连续6段，用户确认顺序、取消和结束后残留均正常；两轮均零丢帧、hold=0、单次结算。
- `OPT-TERM-001`：`in_progress（代码完成，统一验收待执行）`。App 同传设置已支持通用、商业、科技、医疗、旅游、餐饮、娱乐单选并持久化；API 校验后把选择和词库版本写入 realtime response/token；Gateway 按 session 选择统一生成 ASR hotwords/corrections、翻译 glossary 和 LLM 保护字段，旧客户端继续回退服务器默认包。自动化门禁通过，Beelink 与 iPhone 尚未部署验收。
- `OPT-OBS-001`：`in_progress（代码完成，统一验收待执行）`。新增账号隔离的 `/sessions/:sessionId/quality-report`，按 session 汇总翻译覆盖率、延迟均值/P95/最大值、丢帧、VAD fallback、端点原因、说话人、overlap 和 Provider 指纹；报告不包含字幕正文、音频或逐帧概率。API 自动化通过，真实 session 报告和告警阈值尚待统一验收。
- `OPT-DATA-001`：`in_progress（代码完成，迁移验收待执行）`。服务器新增 Node 24 SQLite WAL 存储驱动，按实体 ID 增量提交；不同 ID 不互相覆盖，同 ID 陈旧写入显式冲突。session segment 使用独立表和外键级联，账号、会话、用量、账本、术语、Agent 和声音资料继续复用现有 Repository API。默认本地仍可用 JSON，Beelink 通过受控开关迁移。
- `OPT-DATA-002`：`in_progress（代码完成，恢复演练待执行）`。新增 JSON→SQLite 一次性迁移、`quick_check`、SQLite online backup 和维护模式 restore；恢复前自动保留 pre-restore 文件，发布脚本仅在 `MIGRATE_SQLITE=true` 时切换现有服务器。
- `OPT-MOB-001`：iPhone `accepted`。iPhone 后台、锁屏、来电和蓝牙耳机切换均通过；Android 真机验收统一列为 TODO，并在 iOS 产品化完成后启动。
- `OPT-MOB-002`：iPhone `accepted`。iPhone 20句连续采集、蓝牙切换、Listening 静音和声音偏好恢复均通过；Android 真机验收统一列为 TODO，并在 iOS 产品化完成后启动。
- `OPT-UI-001`：代码和自动化门禁完成；`idle/connecting/active/paused/ending/ended/failed` 只展示当前可执行操作，主操作固定在同一槽位，连接中可取消且迟到 session 不会恢复同传。iPhone/Android 真机布局与点击体验验收待执行。
- `OPT-UI-002`：代码和自动化门禁完成；字幕区移除固定 420dp 高度并占满剩余空间，最后一段标记当前句，译文 final 前显示 pending，动态高度字幕可自动跟随并在用户上滑后提供回到底部。iPhone/Android 真机小屏、横屏和 200% 字体验收待执行。
- `OPT-SPK-001`：统一 contract、Call Link participant track、Session Repository、字幕、历史、review 和导出代码完成；真实双端角色归属验收待执行。
- `OPT-SPK-002`：Streaming Sortformer 已在 Beelink 以正式 `provider=sortformer/mode=active` 部署，HTTP Provider、ASR 并行旁路、时间对齐、故障降级和固定双声源测试通过；抢话、重叠、四人和正式真人 RTTM 门禁仍待执行。
- `OPT-SPK-003`：ASR 后置 speaker 对齐、不同 speaker 段禁止合并、字幕标签、历史清单和会话内重命名代码完成，iPhone 已能显示匿名“说话人 1/2”；ASR 段内部按 speaker 切分由 `OPT-SPK-005/006` 负责。
- `OPT-SPK-005`：`accepted`。Gateway 和 Beelink ASR/Speaker Service 已部署；Gateway 对旧 token 或缺失字段强制补齐 `auto + maxSpeakers=4`，Speaker Provider 启用状态、配置来源和失败可观测；稳定 speaker span 可产生单次 `boundaryMs`，标签抖动、低置信度和 overlap 不切段。固定双声源会话和 iPhone 真人双人无停顿轮流说话均正确显示“说话人 1/2”，且句子未跨说话人合并。
- `OPT-SPK-006`：`in_progress`。已修复 Gateway 合并批次错误使用末帧时间的问题；ASR boundary API 已通过真实 PCM 回切，左右段时间轴连续、右侧音频保留且 VAD 不重置。2秒脱敏诊断窗口、boundary hit/miss/error、确认延迟、回切时长、endpoint race 和丢帧指标已贯通。iPhone 真人双人换人断句通过；短停顿竞态、多人诊断和断网快照仍待完成。
- `OPT-SPK-007`：`in_progress`。`turnId + revision` 已贯通 ASR、Gateway 事件、API session、Flutter 字幕和历史；不同 turn 禁止语义合并，批量 ASR 结果按音频时间排序，同 segment 只处理最高 revision。固定双声源和 iPhone 双人输出顺序通过；多人乱序、TTS 和计费幂等仍待联合验收。
- `OPT-SPK-008`：`in_progress`。App、API 和 Speaker Service 默认人数已统一为4；turn 语言画像、revision、overlap/unknown 保护边界、App 和导出已贯通。Gateway 已修复短首轮次只出现一个可靠窗口时无法建立基线、以及 Streaming Sortformer 在两个80ms帧内修订起点时候选被错误清空的问题；真实模型矩阵仍显示四人 DER `4.44%`、重叠 `3.63%`、一分钟稳定性 `3.77%` 通过，普通双人 `22.05%`、1.2秒快速轮换 `35.42%` 未通过。快速轮换预测20段全部落入同一模型槽位，属于模型身份区分门禁，不能用语种或文本规则伪造 speaker；真人三至四人和混合句仍待统一验收。
- `OPT-DEP-001`：`accepted`。API/Gateway 已作为 Docker Compose 发布单元迁入 Beelink `3110/3111`，119条历史和7份声音引用已保留；iPhone Profile 已切换到 Beelink，Mac `3110/3111` 停止后真机仍上传540帧并保存57秒会话，真实 speaker-turn 全链路通过。
- `OPT-DEP-002`：`in_progress`。Beelink 已承载 LiveKit、API、Gateway、ASR、Speaker、翻译和 LLM；Translation Worker 已编入同一镜像，但按 call 启动和 VoxCPM2 在线加载仍需联合验收。
- `OPT-DEP-003`：`accepted`。iPhone Profile 仅包含 `http://100.110.127.117:3110`，构建产物未发现旧 Mac 地址、模型端口或内部密钥；Mac API/Gateway 停止后在线真机链路通过。

当前排期冻结：

- `OPT-VOICE-002`：`todo（真机盲听验收）`。代码、固定音色和 Beelink 部署保留，方言 v2 连续10句尚未验收。
- `OPT-RT-004`：`todo（100次尾句可靠性）`。已有 A/B 冒烟不替代可靠性门禁。
- Android 真机：`todo（iOS 产品化后）`。当前 iOS 产品化里程碑不以 Android 真机结果作为退出条件；Android AudioSession、TTS、UI、ASR、VAD 和长稳验收统一后置。

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
| SPK-008-A | 多人/混合语种验收 | 1-2天 | in_progress | Gateway 短首轮次和160ms起点修订已修复；四人、重叠和一分钟稳定性模型矩阵通过，模型短轮次仍未达标，真人三至四人、中英夹杂和 unknown 待验收 |
| DEP-001-A | Gateway/API 迁入 Beelink | 已完成 | accepted | Docker、数据迁移、App 切址、Mac 停机和服务器真机全链路通过 |

当前关键路径：`部署遗留会话恢复 -> 断网 End 新文案复验 -> SPK-008-A 真人多人/混合语种`。服务器发布单元、Mac 停机和双人链路已验证；短轮次矩阵失败项不能通过放宽 DER 门槛结项。

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
| OPT-S2S-001 | 新增 `SpeechToSpeechProvider` 能力契约 | `in_progress（代码完成，Provider 评测待执行）`；级联与原生语音统一为 `CallSpeechPipeline`，支持 `cascade/native/shadow`，shadow 失败不影响正式输出，未配置 Provider 时禁止误开 |
| OPT-S2S-002 | Gemini Live 国际路线 | 固定语料通过质量、成本、地区和隐私评审 |
| OPT-S2S-003 | GPT-Live 候选接入 | API 正式可用后通过 Provider 评测再上线 |
| OPT-PSTN-001 | 真实 PSTN 服务商媒体协议 | 普通电话接通、译音回灌、失败退款闭环 |
| OPT-AGENT-001 | AI Calling Agent 灰度 | 授权、告知、人工接管、禁拨和风险场景通过验收 |
| OPT-VOICE-001 | VoxCPM2 Hi-Fi 声音克隆 | 录音质量检查、A/B 试听、自然度门禁通过 |
| OPT-VOICE-002 | 朗读声音预设选择 | `todo（真机盲听验收）`；版本化 Provider 目录、固定参考音频、App 选择和会话透传已部署，待普通话、英语及四种方言连续10句 A/B 通过后结项 |
| OPT-SPK-004 | 授权声纹身份识别 | 声纹注册、置信度门禁、撤回、删除和匿名回退 |
| OPT-ANDROID-001 | Android 端侧 ASR 候选 | `todo（iOS 产品化后）`；与系统 ASR、在线 ASR 固定语料对比后决策 |
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
