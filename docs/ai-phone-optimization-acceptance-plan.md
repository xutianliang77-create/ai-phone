# ai phone 优化验收方案

版本：v1.16
日期：2026-07-12
任务来源：`docs/ai-phone-optimization-development-tasks.md`

## 1. 验收原则

- 自动化测试证明协议和边界，真机测试证明用户体验。
- mock 只能用于合同测试，不能证明真实模型、媒体、支付或电话能力完成。
- 每个验收结果必须包含 build、commit/源码快照、模型 fingerprint、设备、网络和时间。
- 模型实验和诊断默认在独立 harness 中完成；正式 App 只安装已进入集成验收的版本。
- P0 任一阻断项失败，版本不得进入外部付费测试。

## 2. 验收环境矩阵

| 类型 | 最低覆盖 |
| --- | --- |
| iOS | 当前主测 iPhone、一个小屏设备或等效模拟尺寸、最新稳定 iOS |
| Android | 一台中端真机、一个低内存模拟器、主流系统版本 |
| 网络 | 稳定 Wi-Fi、蜂窝、100ms 延迟、3% 丢包、断网恢复 |
| 音频 | 扬声器、有线/蓝牙耳机、安静、咖啡厅噪声、外放语音 |
| 模型 | 端侧 Nemotron；在线 MarbleNet + Qwen3-ASR + Hy-MT2 + VoxCPM2；LLM no-thinking |
| Call Link | App Host、Safari/Chrome Guest、微信 WebView 降级路径 |

## 3. P0 功能验收

| 验收编号 | 对应任务 | 场景 | 通过标准 |
| --- | --- | --- | --- |
| AC-RT-001 | OPT-RT-001 | 开始、暂停、继续、结束、再次开始 | 状态和按钮完全匹配，无重复会话 |
| AC-RT-002 | OPT-RT-002 | 断网、杀 App、WS close、重复 End | 点击结束后本地立即进入终态；可用网络下历史可打开，用量只结算一次；网络恢复后待结算任务可收敛 |
| AC-RT-003 | OPT-RT-003 | 中文长句在中间停顿 | 语义完整句可合并，不重复、不永久等待 |
| AC-RT-004 | OPT-RT-004 | 说完立即点结束 | 最后一句原文和译文均保存 |
| AC-RT-005 | OPT-RT-005 | 自然声音和“我的声音”固定句、20句长短混合 TTS | 响应明确报告模型/输出采样率；48k 模型 PCM 重采样为24k后样本时长不变、音高正常；播放顺序与字幕一致，结束后无残留声音 |
| AC-VAD-001 | OPT-VAD-001 | 低音量真机语音、静音、中等噪声、较大非语音噪声、800ms 音频批次 | 低音量可检出；三类非语音均不产字幕；health 为 marblenet 0.5；无 fallback |
| AC-VAD-002 | OPT-VAD-002 | 模型资产缺失、ONNX 推理异常、会话正常结束 | 自动切 RMS 且 ASR 继续；session 报告记录 fallback、fingerprint 和 endpoint reason |
| AC-VAD-003 | OPT-VAD-003 | 对话、聆听、Call Link、8kHz PSTN 固定语料 | 各模式门槛通过，切换模式不污染其他 session，可回退统一基线 |
| AC-MOB-001 | OPT-MOB-001 | 朗读、电话/闹钟中断、扬声器和有线/蓝牙耳机切换 | 播放完成和中断结束后当前采集源自动恢复，平台插件不争抢音频会话 |
| AC-MOB-002 | OPT-MOB-002 | 扬声器开启朗读连续说 20 句；有线/蓝牙耳机中交替说话；Listening 继承已保存声音设置 | 扬声器不自激，播放结束后下一句完整；耳机播放期间持续识别；Listening 不输出声音，切回对话后恢复原声音偏好 |
| AC-UI-001 | OPT-UI-001 | 遍历所有 realtime 状态 | 只显示可执行动作，主按钮稳定不跳位 |
| AC-UI-002 | OPT-UI-002 | 320dp、横屏、200% 字体、长字幕 | 无溢出和遮挡，最新字幕可见，可回到底部 |
| AC-UI-003 | OPT-UI-003 | 同传中打开设置 | 显示锁定原因，可结束后修改 |
| AC-UI-004 | OPT-UI-004 | 中英、深浅色、读屏 | 核心控件有语义标签，颜色和字号可读 |
| AC-UI-005 | OPT-UI-005 | 生成 iOS/Android 截图 | 真 App、中文正常、无 Debug、平台素材不重复 |
| AC-SEC-001 | OPT-SEC-001 | 伪造他人 reference id | API 拒绝，不能生成 ready profile |
| AC-SEC-002 | OPT-SEC-002 | 检查 App、代理和 Gateway 日志 | 不出现原始 realtime token |
| AC-REL-001 | OPT-REL-001 | 修改 TS 源码但不 build | 发布门禁失败并指出 dist 不一致 |
| AC-IOS-001 | OPT-IOS-001 | 安装后脱离 Flutter/Xcode 启动 | 产物无 `Runner.debug.dylib`，桌面图标可独立启动 |
| AC-IOS-002 | OPT-IOS-002 | 卸载、安装、冷启动循环 20 次 | 20 次全部进入首屏，无新增 `.ips` 崩溃报告 |
| AC-DEP-001 | OPT-DEP-001 | 停止 Mac 上 API/Gateway/模型服务 | 手机在线模式仍连接统一服务器并正常翻译 |
| AC-DEP-002 | OPT-DEP-002、OPT-DEP-003 | 检查 App 配置和服务器健康页 | 运行节点只有手机和服务器；App 无内部模型地址 |

当前自动化证据：`AC-UI-001` 已覆盖全部七种 realtime 状态、合法动作集合、主操作横向位置、命令分发和连接中取消竞态。iPhone/Android 真机上的单手点击、动态字体和横竖屏视觉检查仍标记为未执行，不计入完整验收通过。

`AC-VAD-001` 已验收通过：NeMo/ONNX 逐帧概率最大误差 `2.38e-7`；低音量真机样本可检出；静音、中等噪声和较大非语音噪声均返回 `204`；800ms 批次真实 HTTP 链路正确转写；Beelink health 返回 `vadProvider=marblenet`、`vadThreshold=0.5` 且无降级日志。

`AC-UI-002` 已覆盖工作区随页面高度增长、320dp 宽度、横屏、200% 字体、长字幕、当前句、翻译 pending、自动跟随及回到底部。iPhone/Android 真机截图和读屏焦点检查仍标记为未执行。

## 4. 质量指标

### ASR 与翻译

| 指标 | P0 门槛 | P1 目标 |
| --- | ---: | ---: |
| 中文 CER | <= 0.12 | <= 0.08 |
| 英文 WER | <= 0.18 | <= 0.12 |
| 中英自动方向准确率 | >= 95% | >= 98% |
| 正常语句有译文比例 | >= 99% | >= 99.5% |
| 最后一句保存成功率 | >= 99% | >= 99.5% |
| 翻译人工评分 | >= 4.0/5 | >= 4.3/5 |

英文字母串、姓名、型号和缩写单独归类，不按普通英文句子计算翻译质量。

### 延迟与稳定性

| 指标 | 门槛 |
| --- | ---: |
| 首次连接成功率 | >= 99/100 |
| 首字幕 P50 | <= 1.2s |
| 首字幕 P95 | <= 2.5s |
| final 译文 P95 | <= 4.0s |
| TTS 首包 P95 | <= 3.5s |
| 30 分钟崩溃数 | 0 |
| 30 分钟不可恢复断线 | 0 |
| 字幕/TTS 乱序 | 0 |

### VAD 与端点

| 指标 | P0 门槛 | P1 目标 |
| --- | ---: | ---: |
| 低音量语音召回率 | >= 95% | >= 98% |
| 纯静音误触发率 | <= 0.5% | <= 0.1% |
| 非语音噪声误触发率 | <= 2% | <= 1% |
| VAD 首次确认 P95 | <= 200ms | <= 120ms |
| 对话端点 P95 | <= 1200ms | <= 900ms |
| VAD fallback 后 ASR 可用率 | 100% | 100% |
| 自身 TTS 回灌字幕 | 0 | 0 |

TTS 回灌指标由 App playback gate/AEC 验收，不能把 VAD 对合成语音的响应直接判定为模型失败。

## 5. P1 功能验收

| 验收编号 | 对应任务 | 通过标准 |
| --- | --- | --- |
| AC-LLM-001 | OPT-LLM-001 | 100 条样本无 thinking、提示词或 JSON 外文本；超时回退原文 |
| AC-LLM-002 | OPT-LLM-002 | raw、optimized、translated 可追溯且导出一致 |
| AC-LLM-003 | OPT-LLM-003 | 摘要、决定、待办、事实均有 evidence segment |
| AC-UI-006 | OPT-UI-006 | 历史列表展示标题、日期、时长、语言和摘要；两步内可查看纪要、全文和术语 |
| AC-TERM-001 | OPT-TERM-001 | 六个行业包中英文词均能用于热词、翻译和保护字段 |
| AC-SPK-001 | OPT-SPK-001 | Call Link/PSTN 独立音轨角色归属准确，字幕、历史、导出和 review 字段一致 |
| AC-SPK-002 | OPT-SPK-002、OPT-SPK-003 | 双人/多人固定语料达到 DER、切换延迟和 30 分钟标签稳定性门槛，不跨 speaker 合并 |
| AC-SPK-004 | OPT-SPK-005 | 旧 token 或未传 speaker 配置仍由服务器启用四人默认值；Provider 失败可从日志定位；重复/乱序帧不破坏会话；新 speaker 证据不足时不切段，达到240ms、65%占比、0.60置信度且连续稳定后产生一次边界 |
| AC-SPK-005 | OPT-SPK-006 | 两人无停顿快速换人时 ASR 音频在 `boundaryMs` 切开，上一人和下一人文本不进入同一 turn；session 保存 hit/miss/error、确认延迟、回切时长、丢帧、endpoint race 和 endpoint reason；重复 End 不覆盖首份诊断 |
| AC-SPK-006 | OPT-SPK-007 | 2至4人交替和模型乱序返回时，翻译按 turn startMs 展示，不跨 speaker 拼接，不重复 TTS 或计费；旧 revision 可补译文但不能回滚归属 |
| AC-SPK-007 | OPT-SPK-008 | 中文夹英文、英文夹中文、姓名、型号、抢话和重叠时，语种变化不触发硬断点；主 speaker 可翻译；overlap 和 unknown 如实显示 |
| AC-CALL-001 | OPT-CALL-001 | Host + Guest + Worker 连续 30 分钟，字幕和译音双向可用 |
| AC-CALL-002 | OPT-CALL-002 | 未完成 PSTN 不作为主入口，实验状态清晰 |
| AC-SCAN-001 | OPT-SCAN-001 | 40 张图片 OCR、翻译、保存和分享流程完成 |
| AC-DATA-001 | OPT-DATA-001 | 并发 50 个 session 结束、退款、保存不丢数据、不重复结算 |
| AC-DATA-002 | OPT-DATA-002 | 在线写入时生成快照并恢复 | quick_check 通过，session、ledger、对象 hash 一致 |
| AC-OBS-001 | OPT-OBS-001 | session 报告包含延迟、失败、fallback 和模型指纹，敏感字段脱敏 |
| AC-VAD-004 | OPT-VAD-004 | segment、speaker、history、review 的 speechStart/speechEnd 和 endpointReason 一致，不保存逐帧概率 |

## 6. P2/P3 专项验收

| 验收编号 | 对应任务 | 通过标准 |
| --- | --- | --- |
| AC-S2S-001 | OPT-S2S-001 | 原生语音和级联路线使用同一 session 协议，可独立灰度和回退 |
| AC-S2S-002 | OPT-S2S-002 | Gemini Live 固定语料的质量、延迟、成本、地区和隐私评审通过 |
| AC-S2S-003 | OPT-S2S-003 | GPT-Live API 正式可用，Provider 合同与固定语料评测通过 |
| AC-PSTN-001 | OPT-PSTN-001 | 真实号码完成拨号、接通、双向译音、结束、结算和失败退款 |
| AC-AGENT-001 | OPT-AGENT-001 | 告知、授权、禁拨、频控、人工接管和高风险拒绝全部通过 |
| AC-VOICE-001 | OPT-VOICE-001 | 盲听自然度、清晰度、相似度达标，录音不合格可识别并重录 |
| AC-SPK-003 | OPT-SPK-004 | 未授权不生成声纹，低置信度回退匿名，撤回和删除后不能再次命中身份 |
| AC-ANDROID-001 | OPT-ANDROID-001 | 固定语料、功耗、温升和延迟均有报告，达到门槛后才替换系统 ASR |
| AC-VAD-005 | OPT-VAD-005 | iOS CoreML、Android ONNX 与现有端点检测使用同一语料评测；低音量、噪声、耗电、温升、包体和实时系数均有报告 |
| AC-DATA-003 | OPT-DATA-003 | SQLite 迁移 PostgreSQL/Redis 演练 | 数量、余额、幂等键和对象引用一致，可回滚 |

说话人专项证据必须同时包含：Call Link 多参与者独立音轨、安静双人、三人和四人单麦克风、快速抢话、重叠语音、中英混说、断网重连、30分钟稳定性、会话内重命名、纪要和三种导出。模型服务不可用时 ASR/翻译仍须继续，UI 显示匿名或未知，不得误显示实名。对话和聆听不得使用固定两人假设；单麦克风超过4人时必须明确能力降级，不伪造稳定身份。

`AC-SPK-005` 已通过：Gateway 合并批次使用首帧时间戳；boundary 有替代 transcript 时去除重叠普通端点结果，boundary 为空时保留普通端点结果并记录 race；断网 cleanup 前冻结诊断快照；API 白名单保存计数和时长，不接受或持久化原始 PCM/字幕字段。固定双声源会话 `4296e08a-3b2f-4449-9ebb-0299f142db49` 正确形成两位 speaker，时间轴在边界连续，`hit=1`、`miss/error/race/drop=0`、确认延迟1040ms、回切4240ms；iPhone 真人双人无停顿轮流说话正确显示“说话人 1/2”，断句不跨人。

`AC-SPK-006` 当前证据：contracts、ASR、Gateway、API、Flutter 内存态和本地历史均保留可选 `turnId/revision`；不同 turn 强制释放待合并段；批量 ASR 结果按 `startMs/endMs` 排序；最高 revision 幂等生效；迟到译文可补齐，但旧 speaker、timing、sourceText 和 turnId 不会回滚。Node 全仓、Flutter 255 项、analyze、typecheck 和文件大小门禁通过。部署后固定双声源会话 `8703925d-c08e-4e1e-bff6-36a533a40146` 保存 `turn_1/speaker_1` 中文和 `turn_2/speaker_2` 英文，边界连续，hit=1、miss/error/race/drop=0，确认延迟720ms。iPhone 双人/多人验收尚未执行，因此状态仍为 `in_progress`。

`AC-SPK-004` 本轮故障证据：失败真机会话 `adf37a32-f102-40ea-9b0b-9812733f99d0` 的7个 segment 均无 speaker/turn，诊断边界计数为0，且 Beelink 没有对应 speaker session 创建记录。修复后 Gateway `/health` 显示 `speakerProvider=http`、`speakerTimeoutMs=2000`；固定双声源会话 `55dfe12e-59bd-4405-aab5-ed43f3d68004` 保存 `turn_1/speaker_1` 和 `turn_2/speaker_2`，`hit=1`、`miss/error/race/drop=0`、确认延迟720ms。真人 iPhone 复验未执行，因此未标记 accepted。

`AC-SPK-007/OPT-RT-002` 最新证据：iPhone 在线模式两名真人无停顿轮流说话，正确显示“说话人 1/2”，并按说话人边界断句。断网 End 已立即进入本地终态；截图中的异常来自字符串形式 `TimeoutException` 绕过对象类型判断和 `connection.closed` 直接展示，现已统一归一化。Beelink `1a1968c` 启动恢复将27个遗留非终态会话转为 ended，并释放18个 active hold；余额部署前后均为29921秒，最新 ledger 未新增恢复扣费。Flutter 260项、API 181项、Node 全仓、analyze/typecheck 门禁通过；Profile 安装 UUID `C64B9E0A-9C32-4837-A8B7-7C578C1B5EBE` 且独立进程存活，待真机复验中文提示。

`AC-RT-002` 已通过新版本真机复验：session `7a576a03-d139-4e42-a473-bb0ee13fb63a` 在断网 End 后先显示本地结束和待同步提示，恢复网络后 durable outbox 自动收敛为 ended；2段字幕完整，`consumedSeconds=21`、`heldSeconds=0`。ledger 仅有 `8cc0204b-b092-46c7-95a1-0f02ff422548` 一条 `-21` 秒记录，幂等键为 `settle:7a576a03-d139-4e42-a473-bb0ee13fb63a`。

`AC-RT-003/004` 已通过：RT-003B session `f3bb9ac8-8300-4054-8fa5-410ad64e0ec0` 三轮 silence final 均有译文，估算整句延迟全部低于2.5秒。RT-003A 最终 session `c7c915b7-d5d2-4ab0-9e3d-58f52adb92ad` 三轮同句产生3段字幕和3段译文，无硬切未来后缀扩写、真实 suffix 重复或领域词 context 泄露；427帧零丢失，44秒仅一条 settle ledger，hold=0。第三轮 ASR 少开头时间短语属于识别召回质量，不属于 SegmentAssembler 扩写/重复缺陷。失败 session `7b348952-19ad-4cd9-9a50-57c4c6614b95` 继续保留为回归样本。RT-004A session `52861225-aece-42fd-aef0-8fc0d550d0a1` 的最后一句、编号407和提交时间完整保存并翻译；RT-004B session `46b92293-6efd-4d01-9e4c-0ad902bad21f` 在翻译处理中立即结束后完整保留编号408、明天下午三点和完整报告，尾句到 ended 收敛约1.34秒，169帧零丢失，hold=0且仅一条 `-19` 秒 ledger。

`AC-RT-005` 部署前证据：已定位 VoxCPM2 模型真实输出48k、服务错误标记24k且未重采样，导致声音时长和感知延迟翻倍。修复后本机21项 TTS 测试通过；Beelink 当前推理 Python 使用临时源码验证16/24/48k一秒440Hz波形均输出24000个24k样本，时长仍为1秒且正向过零数439/440/439。自然声音与个人克隆共用统一输出路径；尚未部署和完成 iPhone 听感复验，因此 AC-RT-005 仍未通过。

`AC-RT-005` 最新修复证据：真机会话 `1d365c87-c54b-44f7-80e4-4856da214c86` 的自然声音无明显可听输出，服务器同句测得 `-35.77 dBFS`；会话 `fcde26b2-ad5a-4387-b855-55dce39f5f98` 的“我的声音”出现疑似提示泄露。根因是英文风格描述被直接拼入 VoxCPM2 正文，且 preset 输出响度过低。已部署提交 `3659b76/7fed440`：输入正文不再插入控制提示；低响度音频按约 `-18 dBFS` 目标、8倍最大增益和0.95峰值上限提升。部署后自然声音和当前有效 `ultimate_clone` 固定句均为 `-17.99 dBFS`，ASR 回听只包含目标正文，未出现提示词。App 无需重装；iPhone 听感和20句顺序仍待复验，因此 AC-RT-005 尚未通过。

`AC-RT-005` 真机听感子项已通过：用户确认自然声音和“我的声音”均无问题，未再出现无声或提示词泄露。复测会话 `16795fdb-c251-4512-b6c6-68531e4698e3`、`b8aaaeef-71a9-4e17-9c02-ca858b6b0de1`、`0110f888-7bdc-490b-b9ec-232bd96c8447` 均为 ended，合计8段，hold=0，各自仅一条 `settle:{sessionId}` ledger。20句播放顺序、暂停/结束取消和残留声音尚未验收，因此 AC-RT-005 整项仍未通过。

`AC-RT-005` 最终真机验收通过：长测 session `99812932-3d12-4675-bc00-b1ae87a65e3f` 连续产生19段字幕和译文，1719帧零丢失；结束/取消 session `c9251e1b-8cca-45db-bdf5-12766ab2d016` 产生6段，666帧零丢失。用户连续执行两轮后确认 TTS 顺序、播放取消、结束后无残留声音均正常。两个 session 均 ended、hold=0，并分别只有一条 `settle:{sessionId}` ledger，因此 AC-RT-005 标记 `accepted`。

`AC-SPK-002/006/007` 新自动矩阵：固定生成26段四种合成声音，并组成双人轮换、1.2秒快速切换、overlap、四人和一分钟稳定性语料。active Sortformer 结果为：四人 DER `4.44%`、overlap `3.63%`、一分钟 `3.77%`，均无标签漂移并通过；普通双人 DER `22.05%`，因早期同一声音被临时分配到第三槽位略超门槛；快速切换 DER `35.42%`，未通过。失败项保留为阻塞证据，不调整20%门槛。另有 Beelink 全链路会话 `25b48a5c-3cff-490b-8091-929b62d91f2a` 通过，保存 `speaker_1/2`、`turn_1/2`、中英文画像，hit=1、drop/miss/error/race=0、确认延迟880ms。

`AC-DEP-001/002` 服务器阶段证据：Beelink 使用 `ai-phone-api` 与 `ai-phone-gateway` 两个 `restart: unless-stopped` 容器运行同一非 root 镜像，API `/health` 宣告 `ws://100.110.127.117:3111/realtime`，Gateway 为 Hy-MT2 + HTTP ASR + active Speaker + API history sink 且 release readiness ready。原 Mac JSON store 和7份声音引用已迁移；iPhone Profile 只包含 Beelink API 地址，Mac `3110/3111` 停止后真机会话 `23705ff5-67ea-4955-84e1-f4b8bfae63e7` 仍上传540帧、结束并保存10段/57秒，证明两层部署和手机配置边界通过。`OPT-DEP-002` 仍需补按 call 启动 Worker 与 VoxCPM2 联合验收。

## 7. UI 专项验收

检查页面：同传、设置弹层、通话、扫描、记录、纪要、账号、我的声音。

每个页面必须验证：

- 空、加载、成功、失败、无网络、无权限、余额不足状态。
- 320dp、390dp、大屏和横屏布局。
- 100%、150%、200% 系统字体。
- 中文、英文和最长文案不截断关键操作。
- VoiceOver/TalkBack 焦点顺序符合视觉顺序。
- 主操作单手可达，危险操作有二次确认。
- 页面不展示模型名、URL、token、内部错误栈等工程信息。
- 不可用能力隐藏或标为实验，不使用无响应按钮占位。

## 8. 回归语料

固定包含：

- 中文短句、长句、数字、姓名、地址、金额。
- 英文短句、长句、字母串、型号和缩写。
- 中英交替 20 轮和同句混说。
- 商业、科技、医疗、旅游、餐饮、娱乐术语。
- 影视外放、咖啡厅噪声、远场语音和歌曲场景。
- 快速点暂停、结束、前后台切换和网络中断。

歌曲识别和强噪声可作为增强指标，但必须明确标注能力边界，不能用失败结果污染普通对话评分。

## 9. 证据包

每次候选版本至少归档：

```text
acceptance/<version>/
  build-info.json
  device-matrix.json
  provider-fingerprints.json
  realtime-metrics.json
  test-results/
  screenshots/
  screen-recordings/
  redacted-logs/
  known-issues.md
```

验收报告必须说明：通过、条件通过、失败、未执行；未执行不得按通过统计。

## 10. 发布判定

### 内测版

- 所有 P0 自动化和真机验收通过。
- 无 P0 崩溃、漏最后一句、TTS 打断 ASR、重复扣费问题。
- 可保留 Call Link、PSTN、Agent、我的声音为实验或隐藏状态。

### 灰度版

- P0 全部通过。
- P1 的 LLM、历史、行业词、Call Link、数据和观测全部通过。
- 完成容量、成本、合规、告警和生产配置检查。

### 商业版

- 灰度至少运行两周且核心 SLO 达标。
- 支付、退款、PSTN、AI 告知、投诉举报和数据删除均有真实闭环。
- 不存在开发占位备案号、测试密钥、Tailscale 测试地址或 Debug 构建素材。
