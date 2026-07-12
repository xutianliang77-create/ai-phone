# ai phone 优化开发计划

版本：v1.9
日期：2026-07-12
任务来源：`docs/ai-phone-optimization-development-tasks.md`

## 1. 计划口径

计划按 8 周基线制定。若只有一名全栈开发者，周期按 1.5 至 2 倍估算；外部短信、支付、DNS/TLS 和 PSTN 服务商等待时间不计入纯开发工期。

发布策略：每个阶段都形成可独立回归的版本，不把所有任务积压到最后统一测试。

## 2. 里程碑

| 里程碑 | 周期 | 目标 | 退出条件 |
| --- | --- | --- | --- |
| M0 基线冻结 | 第 1–2 天 | 固定版本、语料、设备和指标 | 可重复生成当前质量基线 |
| M1 实时稳定 | 第 1–2 周 | 解决漏句、断句、异常结束和朗读打断 | P0 实时链路验收全部通过 |
| M2 发布级 UI | 第 3 周 | 完成核心同传 UI、设计系统和截图链路 | UI、无障碍和截图门禁通过 |
| M3 智能记录 | 第 4 周 | 完成 LLM 纠错、三文本、纪要和行业设置 | review 可追溯且无 thinking 污染 |
| M4 Call Link 与数据 | 第 5–6 周 | 真人双端闭环、SQLite WAL、备份恢复和观测 | 30 分钟双端测试和并发数据测试通过 |
| M5 灰度发布 | 第 7 周 | 合规、告警、容量、支付前置检查 | 国内灰度门禁 ready |
| M6 增强路线 | 第 8 周起 | Gemini/PSTN/Agent/声音克隆专项 | 各专项独立评测通过后灰度 |

### 当前迭代基线

- `OPT-SPK-005` 已完成代码、自动化、Beelink ASR 部署和固定双声源无停顿全链路验证，当前状态为 `in_progress`，只差 iPhone 双人快速换人验收。
- `OPT-SPK-006` 的 PCM boundary 回切已通过真实音频连续性验证；合并批次时间轴根因已修复，诊断窗口、竞态指标和 session 持久化已完成代码及仓库级门禁，等待部署后的真实 session 与真机验收。
- 当前临时链路为 iPhone -> Mac API/Gateway -> Beelink 模型服务，只用于联调。正式退出条件仍是 iPhone -> Beelink 唯一公开入口，Mac 不参与运行链路。
- 下一开发主线固定为：真机 speaker boundary -> Turn Buffer 可观测性与幂等 -> speaker-turn 翻译 -> 多人混合语种 -> Beelink 单服务器收敛。

## 3. 分阶段任务

### M0：基线冻结

- 建立独立 realtime/model/UI test harness。
- 固定 iPhone、Android、Wi-Fi、蜂窝、弱网测试矩阵。
- 固定中英短句、长句、快速切换、行业词、噪声和 TTS 语料。
- 记录当前 CER/WER、漏译率、首字幕、final、TTS 首包和崩溃情况。
- 保存当前 App 截图、Gateway 日志和模型 fingerprint。
- 执行 `OPT-REL-001`，把源码与 `dist` 一致性加入发布门禁。
- 执行 `OPT-IOS-001/002`，固定 Profile/Release 安装流程并归档 20 次冷启动结果。
- 执行 `OPT-DEP-001`，把 Beelink 定义为唯一测试服务器，Mac 退出运行链路。

交付：`baseline.json`、语料清单、已知问题列表、基线录屏。

### M1：实时稳定

执行顺序：

1. 冻结已验收的 `OPT-VAD-001` MarbleNet 阈值 0.5，不与后续断句参数同时调整。
2. `OPT-VAD-002` VAD 观测、fallback 和端点原因。
3. `OPT-RT-001` 状态机。
4. `OPT-RT-003` SegmentAssembler。
5. `OPT-VAD-003` 对话、聆听、Call Link、PSTN 模式端点。
6. `OPT-RT-004` flush。
7. `OPT-RT-002` 异常 finalize。
8. `OPT-RT-005` TTS 队列。
9. `OPT-MOB-001` 音频协调和 `OPT-MOB-002` 回声策略。
10. `OPT-SEC-001/002` 安全加固。
11. `OPT-DEP-002/003` 单服务器发布单元和手机配置边界。

阶段内每天至少跑一次无 TTS 和有 TTS 的 10 句 smoke；阶段末跑 30 分钟 soak。

当前进度：`OPT-VAD-001` 已通过真机测试并标记 `accepted`。生产基线固定为 MarbleNet v2、阈值 0.5、1000ms 滚动窗口、连续 3 帧平滑和 RMS 自动降级。`OPT-VAD-002` 与 `OPT-SPK-006` 合并建设 session 观测字段，避免分别维护两套时间轴和诊断口径；之后再通过固定语料开展 `OPT-VAD-003`，不得直接把全局阈值改成 0.7。

### M2：发布级 UI

执行 `OPT-UI-001` 至 `OPT-UI-005`：

- 状态化底部控制。
- 字幕占满剩余空间，增加当前句和翻译 pending。
- 设置按模式、处理、语言、声音分组。
- 建立颜色、文字、间距、按钮和状态 Token。
- 修复 320dp、横屏、深色模式、200% 字体和读屏。
- 截图直接启动真实 App 页面，分别生成 iOS/Android 素材。

M2 不调整模型参数，避免 UI 和模型体验同时变化导致问题难以归因。

当前进度：`OPT-UI-001/002` 已完成代码和自动化门禁。Streaming Sortformer 已在 Beelink 部署，Gateway 对齐和 iPhone 匿名“说话人 1/2”基础测试通过；抢话、重叠、四人、历史重命名、纪要和导出仍待正式验收，因此 `OPT-SPK-002/003` 尚不能整体标记 `accepted`。

### M3：智能记录

执行 `OPT-LLM-001` 至 `OPT-TERM-001`：

- 实时纠错仅处理 final，并设置严格超时。
- 保存 raw、merged、optimized、translated。
- 会后 review 输出固定 schema 和 evidence。
- 历史列表展示 AI 标题、时长、语言和摘要。
- 历史详情展示摘要、重点、全文、术语、待办和关键事实。
- App 增加行业包选择，服务端返回实际生效词库版本。
- 执行 `OPT-SPK-001`，先复用 Call Link 独立音轨角色并贯通字幕、历史和 review。
- 执行 `OPT-SPK-002/003`，在独立 harness 评测通过后接入单麦克风流式说话人分离。
- 执行 `OPT-SPK-005/006`，把确认的 speaker boundary 前移到 ASR 音频提交阶段。
- 执行 `OPT-SPK-007`，翻译、纠错和 TTS 统一使用 speaker turn，不跨说话人合并。
- 执行 `OPT-SPK-008`，默认支持模型容量内4人，语种变化不作为硬断点。
- 执行 `OPT-VAD-004`，只持久化 segment 级 VAD 摘要和时间轴，不保存 20ms 原始概率。

### M4：Call Link 与数据

- 执行 `OPT-CALL-001/002`，完成 App Host + Web Guest + Worker 真人媒体闭环。
- 执行 `OPT-DATA-001` 和 `OPT-DATA-002`，把 JSON store 迁移至服务器 SQLite WAL，并完成一致性备份和恢复。
- 执行 `OPT-OBS-001`，建立 session 质量报告、脱敏日志和告警指标。
- 数据迁移必须保留回滚脚本和迁移前只读备份。

### M5：灰度发布

- 跑完整功能、设备、弱网、长稳、数据、安全和 UI 验收。
- 补 DNS/TLS/TURN、短信、告警 webhook、隐私文案和真实备案材料。
- 计算单会话成本、并发容量、P95/P99 和故障降级策略。
- 仅开放通过验收的入口；PSTN、Agent 和声音克隆可保持实验状态。

### M6：增强路线

- 执行 `OPT-S2S-001`，先实现 `SpeechToSpeechProvider` 契约和独立 harness。
- 执行 `OPT-S2S-002`，Gemini Live 只用于国际版候选，不改变国内默认路线。
- `OPT-S2S-003`、`OPT-PSTN-001`、`OPT-AGENT-001`、`OPT-VOICE-001`、`OPT-ANDROID-001`、`OPT-DATA-003` 分别立项，不互相绑定发布。
- `OPT-SPK-004` 声纹实名属于单独授权的增强能力，不与匿名说话人分离绑定发布。
- `OPT-VAD-005` 端侧 MarbleNet 只在独立 iOS/Android harness 评测，通过功耗、温升和召回门禁后再决定是否进入 App。

## 4. 关键路径

```text
状态机
  -> MarbleNet VAD / Endpoint
  -> Streaming Sortformer / SpeechTurnCoordinator
  -> ASR Turn Buffer
  -> SegmentAssembler
  -> flush/finalize
  -> speaker-turn 翻译队列
  -> TTS 队列
  -> AudioSessionCoordinator
  -> 状态化 UI
  -> 30 分钟稳定性验收
  -> Call Link 真人闭环
  -> 灰度发布
```

LLM 纪要、扫描 UI 和国际模型 Provider 可在 M1 稳定接口冻结后并行开发。

## 5. 风险与处理

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| iOS 播放重配音频会话 | ASR 在第一句后停止 | 所有采集和播放统一经过 AudioSessionCoordinator |
| ASR 伪流式断句 | 语义断裂、漏译 | SegmentAssembler + 最大等待时间 + flush |
| VoxCPM2 听感不稳定 | 用户关闭朗读 | 默认声音通过门禁后才启用，个人声音独立灰度 |
| LLM 响应慢或输出 thinking | 字幕延迟和污染 | no-thinking、schema、超时回退，不阻塞原始字幕 |
| JSON store 并发丢数据 | 历史、结算错误 | M4 迁服务器 SQLite WAL；多实例阶段再迁 PostgreSQL/Redis |
| Mac 与服务器跨机串联 | 增加延迟和故障面 | 所有运行组件统一部署到服务器，Mac 仅开发运维 |
| iOS Debug 包独立启动 | 安装后点击即闪退 | 真机手动测试只安装 Profile/Release，脚本阻断 Debug dylib |
| 未完成能力过早暴露 | 产品可信度下降 | 通话页按核心/实验分层，未完成入口隐藏 |
| 模型和 UI 同时调整 | 无法定位回归 | 每个里程碑冻结变量，模型变更必须独立评测 |
| VAD 阈值过严 | 低音量漏句 | 生产固定 0.5；0.7 仅作为严格档 A/B，不直接替换 |
| VAD 将 TTS 当真人语音 | 自激和重复字幕 | VAD 不承担回声识别，继续使用 playback gate、AEC 和耳机策略 |

## 6. 进度管理

- 每个任务状态使用：`todo`、`in_progress`、`blocked`、`accepted`。
- `accepted` 只由验收证据触发，不以代码合并代替验收。
- 每个里程碑结束更新功能完成度矩阵和 `PROGRESS_LOG.md`。
- 阻塞超过一个工作日必须记录阻塞方、临时降级和恢复条件。
- 真实模型、真机和远端服务测试必须记录运行版本、环境和时间，避免用旧结果证明新版本。

## 7. VAD 优化执行计划

| 阶段 | 任务 | 预计工作量 | 状态 | 交付与退出条件 |
| --- | --- | ---: | --- | --- |
| V0 | `OPT-VAD-001` 服务器主 VAD | 已完成 | accepted | MarbleNet 上线、RMS 降级、真机通过 |
| V1 | `OPT-VAD-002` session 观测 | 0.5天剩余 | in_progress | endpoint reason 和丢帧已贯通；补 Provider、阈值、speech ratio、fallback 和 fingerprint |
| V2 | `OPT-VAD-003` 模式化端点 | 2 天 | todo | 四种模式固定语料和延迟门禁通过，可一键回退 1100ms |
| V3 | `OPT-RT-003/004` 联合回归 | 1 天 | todo | 长句、短停顿、立即结束、断网 flush 无回归 |
| V4 | `OPT-VAD-004` 时间轴贯通 | 1-2 天 | todo | speaker、segment、history、review 使用同一 speech 时间范围 |
| V5 | `OPT-VAD-005` 端侧候选 | 2-3 天，非当前关键路径 | todo | CoreML/Android ONNX 报告完成，通过后再立项集成 |

近期关键路径为 `V1 -> V2 -> V3`，预计 4 个开发日；`V4` 随说话人和智能记录进入 M3，`V5` 不阻塞国内版在线模式。

## 8. 说话人驱动同传执行计划

| 阶段 | 任务 | 预计工作量 | 状态 | 退出条件 |
| --- | --- | ---: | --- | --- |
| S0 | 多人默认统一为4 | 0.5天 | accepted | App、API、Speaker Service 和协议一致，旧客户端2人配置被服务器规范化 |
| S1 | `OPT-SPK-005` 边界协调器 | 0.5天剩余 | in_progress | 已部署且固定双声源全链路通过；iPhone 双人无停顿两轮四句待验收 |
| S2 | `OPT-SPK-006` ASR Turn Buffer | 1天剩余 | in_progress | 时间轴修复、诊断指标和竞态去重自动化通过；补真实 session 指标和真机证据 |
| S3 | `OPT-SPK-007` 翻译队列 | 1-2天 | todo | 不跨 speaker 翻译，最近 turn 只作上下文，输出顺序稳定 |
| S4 | `OPT-SPK-008` overlap/混合语种 | 1-2天 | in_progress | 2至4人、中英夹杂、抢话和重叠策略通过 |
| S5 | 联合真机验收 | 2天 | todo | 对话、聆听、双人、三人、四人、快速换人、混合语种和30分钟稳定性通过 |
| S6 | `OPT-DEP-001/002/003` 两层部署收敛 | 1天 | in_progress | API/Gateway/Worker/LiveKit/模型统一在 Beelink，Mac 停机后真机链路正常 |

剩余实现预计6至8个开发日。近期顺序为 `S1 -> S2 -> S3 -> S4 -> S6 -> S5`；不能通过在现有 Aligner 后增加文本规则替代音频边界回切，也不能以 Mac 中转拓扑作为发布验收结果。

## 9. 近期开发日程与门禁

| 开发日 | 主要工作 | 当日门禁 |
| --- | --- | --- |
| D1 | 部署最新 API/Gateway/ASR；iPhone 双人无停顿验收 | 四句两轮正确换人；历史保存 diagnostics；日志可解释每次 hit/miss |
| D2 | 真实 session 竞态复验；补 VAD fallback/fingerprint | 时间轴无重叠、无空洞、无重复 transcript，诊断字段完整 |
| D3 | `turnId + revision` 数据契约和 Repository 迁移 | 旧历史兼容；新 segment 可追溯 speaker turn |
| D4 | speaker-turn 有序翻译、纠错和 TTS 输入 | 并发响应不乱序、不跨 speaker 合并 |
| D5 | 2至4人、快速换人、中英夹杂、抢话和 overlap | 匿名标签稳定；语言变化不作为硬断点 |
| D6 | API/Gateway/Worker/LiveKit 收敛到 Beelink | 停止 Mac 服务后 iPhone 在线链路通过 |
| D7-D8 | 30分钟 shadow、异常结束、历史、纪要和导出联合回归 | 无漏句、重复结算、崩溃和不可恢复断线 |

每个开发日只允许一个主变量变化。模型版本、VAD 阈值和 Speaker 防抖参数在 D1 至 D8 冻结；若验收失败，先依据 session 指标定位数据流阶段，再决定是否调参。
