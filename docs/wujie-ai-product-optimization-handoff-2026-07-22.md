# 无界AI产品优化任务交接

更新时间：2026-07-22（Asia/Shanghai）

## 1. 任务目标

本支线只负责把“无界AI”现有能力收敛成清晰、稳定、可验收的个人版产品体验。先校准真实完成度，再优化用户流程、信息架构、状态反馈、长会话交互、可访问性和发布呈现。

核心原则：不因为产品优化重写已经通过的 RTC、ASR、MT、TTS、数据和调度主链；新功能必须能追溯到具体用户问题和验收项。

## 2. 唯一生产代码仓库与 Git 基线

- 生产代码仓库：`/Users/xutianliang/Downloads/ai phone`
- `/Users/xutianliang/Downloads/翻译软件app` 主要是售前材料、隔离模型/Android 评测和任务入口，不是生产代码仓库。
- 当前分支：`codex/optimization-m2-flexible-subtitles`
- 当前提交：`e83ca8f20a39566f353aa4e9e080cb6a86bf832e`
- 远端：`origin/codex/optimization-m2-flexible-subtitles`
- 交接时本地和远端 ahead/behind：`0/0`
- 用户原有未跟踪目录：`outputs/`。禁止清理、覆盖、暂存或提交。
- 本交接文档创建后会作为新的未跟踪文件出现；新任务应保留它并在首批交付时决定是否单独提交。

恢复第一步必须执行：

```bash
cd '/Users/xutianliang/Downloads/ai phone'
git status -sb
git rev-list --left-right --count '@{upstream}...HEAD'
git diff --check
tail -220 PROGRESS_LOG.md
```

不得把本文记录的服务器、容器、设备或安装状态当作当前状态；涉及运行环境时必须实时探测。

## 3. 最新已验收基线

### 3.1 代码与自动化

- API：`128 files / 441 tests` 通过。
- Translation Worker：`48 files / 188 tests` 通过。
- Flutter：`362 tests` 通过，Flutter analyze 无问题。
- API/Worker typecheck 和 build、根级 workspace build、LiveKit compatibility、根级脚本 `95 files / 330 tests`、`git diff --check` 通过。
- 最近四个已推送提交：
  - `d55d48d`：Call Room 单角色单活、拒绝重复参与者、Worker 音轨角色门禁。
  - `8c3bd27`：长会话字幕自动跟随、半双工播放时麦克风状态。
  - `4af6e44`：TTS 缓存预热以本次请求墙钟耗时执行门禁。
  - `e83ca8f`：iOS Release Bundle ID 固定为 `cn.qkxy.realtimeinterpreter`。

### 3.2 真实媒体链路

- 90 秒预检：6 个完整 utterance，通过。
- 长稳会话：`981ff159-603b-400d-a9ac-2d77c0000a5a`，持续 `32 分 0.518 秒`，完成 151 段。
- 使用真实 LiveKit RTC、Qwen3-ASR、Hy-MT2、VoxCPM2；不是 mock。
- Provider 重复副作用、lost final、重复结算、晚到 HTTP 410、API 5xx 均为 0。
- 151 条 transcript/translation/TTS/playback 全部闭环；outbox 908 条全部 published。
- ingest 收到/出队/处理 `19174/19174/19174`，drop、overflow、shutdown discard、gap、backpressure 全部为 0。

这证明真实服务端房间和数据流可以长稳运行。它不等于 iPhone 页面已经在同一个 32 分钟房间中完成 151 段 UI 交互验收：当时 iPhone candidate 已安装、启动并存活，但未作为该长跑房间的 Host/Guest。

### 3.3 iOS candidate

- 已安装版本：`0.1.0 (2026072101)`。
- Bundle：`cn.qkxy.realtimeinterpreter`。
- candidate：`/tmp/ai-phone-ios-candidate-2026072101/Runner.app`。
- rollback：`/tmp/ai-phone-ios-rollback-2026071901/Runner.app`。
- Profile 签名、端侧模型资产和独立启动已核对。

### 3.4 隔离服务候选（仅为上次状态）

- Beelink 隔离目录：`/data/models/ai-phone-server-candidates/core-translation-20260721`。
- Compose 项目：`ai-phone-core-candidate-20260721`。
- Tailnet HTTPS：8445/8446；容器端口 3320/3321/8381。
- candidate image digest：`sha256:816d5b1ba4f413735e34d10d84a8263cfe17034d5d1afb99b1f58bc376137041`。
- rollback digest：`sha256:4efd35f3a047b46ce77e0c5aec4475d3dde40ec906d0b8b28e0bb6ef7daf4ef2`。

以上状态来自 2026-07-21。继续使用前必须重新核对身份、GPU、镜像 digest、容器、模型和健康；不得假定仍在运行。

## 4. 当前产品能力图

### 已具备主要闭环

- 五 Tab 中文 App Shell。
- 对话/聆听等同传入口，端侧/在线模式和语言设置。
- 弹性字幕、当前句/译文 pending、自动跟随和回到底部。
- 音频路由、后台/锁屏恢复、Listening 静音、扬声器/耳机策略。
- 记录列表、日期分组、同传/通话/扫描筛选。
- 记录详情中的字幕、纪要、待办、术语、分享/导出骨架；待办持久化已有实现。
- 拍照翻译和目标语言工作流。
- Call Link：App Host、Web Guest、字幕/TTS 事件、LiveKit 译音轨和历史/结算主链。
- 通话首页和手机号拨打 UI 已有产品入口；真实 SIP/PSTN 商业外呼仍延期。
- AI 代打阶段化任务界面和服务端控制面；真实 Agent/PSTN/Egress 仍延期。
- “我的”信息架构、账号、合规、语音和模型诊断页面骨架。

### 已实现但仍需产品级验收

- iPhone 真实加入后的 30 分钟/100 段字幕滚动和交互。
- 上滑、回到底部、快速 ASR/MT/TTS 三阶段更新和内存稳定性。
- 半双工译音播放时“麦克风暂挂”状态能否被普通用户理解。
- Call Link Safari/Chrome/微信 WebView 的加入、权限、无声和降级提示。
- 历史详情、待办、扫描目标语言和分享在真机上的完整闭环。
- 320dp、横屏、深色模式、150%/200% 字体、VoiceOver/TalkBack。
- 空、加载、失败、断网、无权限、余额不足、服务降级状态。

### 不能宣称完成

- 商业发布 ready。
- 真实 SIP/PSTN 翻译电话。
- Autonomous Agent、真实外呼接管和真实 Egress。
- Apple/微信/支付宝真实收费闭环。
- Android 生产 App 全量验收；Android 隔离测试在其他任务处理。
- 模型准确率/速度已经最终优化。用户明确要求先验收功能和数据流，后续再决定是否更换 ASR、翻译或 TTS 模型。

## 5. 文档真值和过期项

读取顺序：

1. `PROGRESS_LOG.md` 最后一个交接段。
2. 本文。
3. `docs/ai-phone-optimization-acceptance-plan.md`。
4. `docs/ai-phone-optimization-development-plan.md`。
5. `docs/domestic-app-feature-completion-matrix.md` 和其他历史计划。

历史矩阵中“Call Link 还没有真实媒体闭环”的表述已经落后于 2026-07-21 的 32 分钟/151 段证据。新任务第一批应校准这些状态，但不得把自动房间长稳误写成 iPhone UI 真机长稳已经通过。

## 6. 本支线范围

### 纳入

- 产品信息架构和入口优先级。
- 核心用户旅程：首次使用、同传、Call Link、记录、扫描、AI 代打、手机号拨打、“我的”。
- 页面状态、错误恢复、用户可理解的反馈和能力边界。
- 长会话字幕可用性、交互性能和无障碍。
- UI 文案、中文产品名和发布呈现一致性。
- 产品行为的自动化测试和真机验收证据。
- 必要的轻量 API/数据合同调整，但必须先证明是产品闭环所需。

### 不纳入或延期

- 替换 ASR/MT/TTS 模型、重新调参或扩大模型评测；除非产品 bug 的根因明确在模型合同。
- 重写 LiveKit/RTC/翻译主链。
- 真实 SIP、Agent、Egress、支付、跨主机 HA、PITR 和 100 并发工程。
- Android 端侧模型封装和独立真机评测。
- 企业版功能；企业版保持独立任务和分支。

## 7. 修正后的产品优化优先级

### P0：真实可用和发布呈现

1. **产品基线校准**
   - 只读审计实际页面、路由、feature flag、测试和最新证据。
   - 更新过期完成度，不把“代码存在”计为“真机通过”。
   - 输出不超过 10 项的 P0 问题清单，每项含复现、用户影响、代码位置和验收。

2. **iOS 长会话 UI 验收**
   - iPhone 实际作为 Host 或 Guest 加入专用房间。
   - 对端自动推送至少 30 分钟、100 段三阶段字幕。
   - 覆盖自动跟随、用户上滑、回到底部、前后台、锁屏恢复、TTS 暂挂状态和结束最后一段。
   - 服务端长稳证据不能替代本项。

3. **核心旅程一致性**
   - 同传：首页到开始/暂停/结束/记录详情完整可达。
   - Call Link：创建、分享、对方加入、权限、字幕/声音、断线/重连、结束。
   - 记录：筛选、日期分组、字幕/纪要/待办、待办跨重启持久化、分享。
   - 扫描：拍照、识别、选择目标语言、翻译、保存/分享。
   - “我的”：账号、模式/模型说明、声音、合规和诊断分组清晰，无重复入口。

4. **发布名和工程信息清理**
   - 修正 release readiness 中仍要求 `ai phone` 的陈旧产品名门禁。
   - 用户页面不得暴露模型名、URL、token、内部错误栈或 staging 地址。
   - “无界AI”、Bundle、图标、版本和发布文案保持一致。

5. **状态和降级可理解**
   - 明确区分：正在连接、已连接、麦克风未授权、译音播放中暂挂、重连、仅字幕、服务降级、已结束。
   - 朗读默认状态和当前是否播音必须在 UI 中可见，避免“有字幕但没有声音”被误认为故障。

### P1：效率、信任和复用

1. 首次使用引导和权限解释，只在需要时请求麦克风/相机/云端语音同意。
2. 记录详情收敛为“纪要、待办、字幕、术语/关键信息”，减少工程字段和重复信息。
3. 统一扫描、同传、Call Link 的语言选择语义和最近使用记忆。
4. AI 代打采用阶段化状态、取消/失败恢复、人工接管和清晰实验标识；不接真实外呼时不得伪装可用。
5. 完成 320/390dp、横屏、深色、200% 字体和读屏专项。
6. 建立产品级埋点/证据：进入、开始、首字幕、首译文、首声音、结束、保存、失败原因；不记录原始敏感语音。

### P2：条件具备后灰度

- 真实 SIP/PSTN 外呼和来电告知。
- Agent Assist，之后再灰度 Autonomous Agent。
- Egress 录音同意、录制、导出和删除闭环。
- 真实支付、退款、余额和订阅体验。
- Android 生产版收敛。
- 模型替换后的新一轮准确率、延迟、成本和长稳对比。

## 8. 首批执行建议

第一批不要直接大改 UI。按以下顺序：

1. 只读运行 App 页面/Widget 测试，建立当前页面截图和路由清单。
2. 将最新真实验收结果同步到完成度矩阵，标出“自动链路通过、iPhone UI 待验收”的双层状态。
3. 深查五个高风险产品点：朗读开关可见性、Call Link 权限/无声提示、长字幕跟随、记录待办持久化、扫描目标语言。
4. 从证据中选择 2–4 个明确 P0 bug，先写失败测试，再做最小修复。
5. 跑相关 Flutter 全量测试和 analyze；服务端合同被触及时再跑对应 API/Worker 全量测试。
6. 构建 Profile candidate 前保留旧安装包；真机安装、部署、服务操作前重新实时探测并记录回滚点。

## 9. 产品验收门槛

### 功能

- 核心五条旅程从入口到记录/终态无死路、无占位按钮、无错误跳转。
- 同一操作重复点击不创建重复 session、participant、task 或扣费。
- 端侧/在线、对话/聆听、字幕/朗读状态与实际行为一致。
- 非阻断异常可恢复；阻断异常提供用户可执行的下一步。

### 长稳和性能

- iPhone 页面持续 30 分钟、至少 100 段字幕，不停止更新、不错误跳离底部、不明显持续增内存。
- 用户主动上滑后不被程序强拉；点击“回到底部”后恢复跟随。
- 除明确插话/结束外，字幕、译音队列和持久化终态一致。

### UI 和无障碍

- 320dp、390dp、横屏、深色和 200% 字体无关键操作裁切。
- VoiceOver/TalkBack 焦点顺序与视觉顺序一致。
- 所有核心页面覆盖空、加载、成功、失败、断网、无权限状态。
- 用户界面无内部模型/端点/密钥/栈信息。

### 证据

- 每项记录 `passed / conditional / failed / not-run`，未执行不得写通过。
- 证据包含 build/commit、设备、服务/模型 fingerprint、截图或录屏、脱敏日志和已知问题。
- 自动化房间、真机 UI、真人听感三类证据必须分开表述。

## 10. 安全和协作边界

- 保留所有用户脏改动和 `outputs/`。
- 默认使用隔离 harness/candidate；未经本任务用户明确授权，不覆盖或编译测试原生产 App。
- 所有服务地址必须可配置，不能把本地或 Beelink IP 写死到业务代码。
- 操作 Beelink 前实时探测；只操作明确命名的隔离 Compose、端口和镜像，不影响旧生产服务。
- 真实录音、电话和云端语音必须有明确同意并遵守当地法律。
- 不把测试 token、私有 env、号码或语音数据提交到 Git。
- 提交按产品问题拆分，每个提交可独立回滚；未经用户要求不要 push。

## 11. 新任务完成定义

本产品优化支线不能以“页面看起来更漂亮”作为完成。至少需要：

1. 最新完成度矩阵与真实证据一致。
2. P0 问题清单有明确优先级、复现和验收。
3. 首批 P0 修复有自动化回归。
4. iPhone 长会话 UI 或其明确阻断被记录，不虚报通过。
5. 核心旅程、状态、发布名和用户可理解性达到上述门槛。
6. `PROGRESS_LOG.md` 更新当前工作、未完成项、后台任务和恢复命令。

## 12. 新任务启动指令

新任务先读取本文、`PROGRESS_LOG.md` 最后两个交接段、当前 `git status/diff` 和以下文档：

- `docs/ai-phone-optimization-acceptance-plan.md`
- `docs/ai-phone-optimization-development-plan.md`
- `docs/domestic-app-feature-completion-matrix.md`
- `docs/domestic-edition-optimization-plan.md`

先做只读产品审计，输出校准后的 P0 清单和首批最小计划；确认修改边界后再实现。真实设备、服务和部署动作必须重新实时探测，不沿用交接中的旧状态。
