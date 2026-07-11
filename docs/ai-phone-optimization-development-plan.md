# ai phone 优化开发计划

版本：v1.0  
日期：2026-07-11  
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
| M4 Call Link 与数据 | 第 5–6 周 | 真人双端闭环、PostgreSQL/Redis、观测 | 30 分钟双端测试和并发数据测试通过 |
| M5 灰度发布 | 第 7 周 | 合规、告警、容量、支付前置检查 | 国内灰度门禁 ready |
| M6 增强路线 | 第 8 周起 | Gemini/PSTN/Agent/声音克隆专项 | 各专项独立评测通过后灰度 |

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

1. `OPT-RT-001` 状态机。
2. `OPT-RT-003` SegmentAssembler。
3. `OPT-RT-004` flush。
4. `OPT-RT-002` 异常 finalize。
5. `OPT-RT-005` TTS 队列。
6. `OPT-MOB-001` 音频协调和 `OPT-MOB-002` 回声策略。
7. `OPT-SEC-001/002` 安全加固。
8. `OPT-DEP-002/003` 单服务器发布单元和手机配置边界。

阶段内每天至少跑一次无 TTS 和有 TTS 的 10 句 smoke；阶段末跑 30 分钟 soak。

### M2：发布级 UI

执行 `OPT-UI-001` 至 `OPT-UI-005`：

- 状态化底部控制。
- 字幕占满剩余空间，增加当前句和翻译 pending。
- 设置按模式、处理、语言、声音分组。
- 建立颜色、文字、间距、按钮和状态 Token。
- 修复 320dp、横屏、深色模式、200% 字体和读屏。
- 截图直接启动真实 App 页面，分别生成 iOS/Android 素材。

M2 不调整模型参数，避免 UI 和模型体验同时变化导致问题难以归因。

### M3：智能记录

执行 `OPT-LLM-001` 至 `OPT-TERM-001`：

- 实时纠错仅处理 final，并设置严格超时。
- 保存 raw、merged、optimized、translated。
- 会后 review 输出固定 schema 和 evidence。
- 历史列表展示 AI 标题、时长、语言和摘要。
- 历史详情展示摘要、重点、全文、术语、待办和关键事实。
- App 增加行业包选择，服务端返回实际生效词库版本。

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

## 4. 关键路径

```text
状态机
  -> SegmentAssembler
  -> flush/finalize
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

## 6. 进度管理

- 每个任务状态使用：`todo`、`in_progress`、`blocked`、`accepted`。
- `accepted` 只由验收证据触发，不以代码合并代替验收。
- 每个里程碑结束更新功能完成度矩阵和 `PROGRESS_LOG.md`。
- 阻塞超过一个工作日必须记录阻塞方、临时降级和恢复条件。
- 真实模型、真机和远端服务测试必须记录运行版本、环境和时间，避免用旧结果证明新版本。
