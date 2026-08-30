# 无界AI验收证据复用与重测去重矩阵

日期：2026-08-30

状态：`FROZEN_EVIDENCE_REUSE_DECISION / NO_REDUNDANT_RETEST`
范围：当前分支 `codex/optimization-m2-flexible-subtitles`，HEAD `0779473`

## 目的

本文件解决“新候选是否需要从头重跑全部真机门”的判断问题。

默认决策改为：**复用仍然有效的旧证据，只验证当前变更真正新增或可能破坏的能力。**
新 bundle、新端口、新镜像或一次运行环境漂移，本身不自动使所有产品功能证据失效。

## 当前基线与差异

- 已通过连续长句真机门的基线提交：`31bc64f219a30bc8c8de05e738c4510e9cfebf83`。
- 当前服务器候选提交：`0779473448ebfa71fc558c478a96f679936b6747`。
- 基线与当前的 `apps/mobile` tree 完全相同：
  `867e2db37152cf5519779b359a814a8e2170875e`。
- `31bc64f..0779473` 没有任何 Flutter/iOS/Android移动端文件变化。
- 变更集中在：
  - ASR最终token timing及ForcedAligner合同；
  - speaker-first高上下文匿名speaker revision；
  - token timing、speaker revision与诊断的API持久化；
  - continuation合并时保留合法token timing；
  - 对应Gateway、API、模型服务、contracts与测试。
- 当前iOS隔离候选相对产品HEAD仅增加独立bundle identity并固定到`4020`；Flutter/Dart源码不变。

## 证据失效原则

只有满足下列至少一项，旧功能证据才失效并允许重测：

1. 该功能直接执行路径的源码发生变化；
2. 客户端/服务器事件或API合同发生不兼容变化；
3. 模型、模型参数、VAD/endpoint策略或runtime fingerprint变化；
4. 翻译、TTS或speaker provider fingerprint变化；
5. 旧证据没有覆盖本次新增的行为；
6. 旧证据本身被证明输入无效、数据不完整或结论错误。

以下情况只要求恢复与重新探测，不自动要求重跑准确率或真机功能：

- 服务进程重启，但恢复后fingerprint完全一致；
- HTTP端口、container名称或bundle identity改变；
- 临时服务错误发生在音频输入前；
- 依赖曾漂移到mock，但在正式运行前恢复到相同冻结身份；
- 新候选首次登录、权限或协议配置。

## 去重矩阵

| 能力 | 既有正式证据 | 当前变化影响 | 决策 | 当前状态 |
| --- | --- | --- | --- | --- |
| iPhone麦克风24kHz上传 | `d65f9c43-c4fa-4dfa-9438-e0a50255287d`，received 1528、drop0 | `apps/mobile` tree完全相同 | 直接复用，不重测 | `REUSE_DEVICE_PASS` |
| 在线账号、协议与权限 | 原bundle已有；独立bundle因沙箱隔离需首次配置 | 仅新bundle沙箱，不是语音功能变化 | 只完成一次setup，不算功能重测 | `SETUP_COMPLETE` |
| 新候选连接4020/4021 | 旧证据在3520；当前endpoint变为4020 | 只影响路由，不影响ASR/MT算法 | 只需连接握手，不需播放完整fixture | `CONNECTIVITY_CONFIRMED` |
| Qwen3-ASR 1.7B基础识别 | 既有统一suite、真机短门及多轮回归；runtime=`12fcb92a…` | 模型、参数、fingerprint未变 | 复用，不重跑准确率 | `REUSE_MODEL_EVIDENCE` |
| MarbleNet真实声学VAD | 既有真机短门和AliMeeting设备证据；fingerprint=`902bd89d…` | 模型与策略未变 | 复用；运行前只核fingerprint | `REUSE_DEVICE_PASS` |
| stable-readable partial策略 | 既有隔离40+10与真机证据；策略=`qwen17_adjacent_prefix_zh_v1` | 当前未修改partial生成或移动端呈现 | 复用，不重跑9.72秒 | `REUSE_POLICY_EVIDENCE` |
| 9.72秒max-duration continuation文本合并 | 真机session=`d65f9c43…`；一个逻辑段、revision7、无`整。整理`/`整整理`；证据SHA=`961988b7…` | 当前只为合并结果保留合法token timing，不改变已通过的文本合并和移动端路径 | 真机文本门直接复用；token timing用服务器/API门覆盖 | `REUSE_DEVICE_PASS` |
| 中文一字受约束去重 | `d65f9c43…`真机通过，speech-quality安全回归覆盖数字/Latin/金额 | 规则语义未变 | 复用，不重测 | `REUSE_DEVICE_PASS` |
| Hy-MT2中文→英文翻译 | 真机短门与AliMeeting均有完整译文；fingerprint=`667fe245…` | 模型、provider、fingerprint未变 | 复用，不重测翻译质量 | `REUSE_MODEL_EVIDENCE` |
| 结束、flush、finalize、outbox与历史 | `d65f9c43…`、`c7829e07…`等真机门通过 | 新API只增加speaker/token字段与revision merge；已有API/server门覆盖 | 通用结束链复用，不重跑短门 | `REUSE_DEVICE_PASS` |
| 单人不被过分裂 | `d65f9c43…`最终只有`speaker_1` | 当前低上下文Sortformer路径未改；高上下文单人安全回退已有server短门 | 复用，不重跑单人短句 | `REUSE_DEVICE_PASS` |
| 低上下文Sortformer A→B→A声学基线 | `c7829e07…`得到2人A→B→A但有459ms跨人污染；`6b3b64b1…`在有效63%声学输入下出现3-slot/3边界 | 旧证据是问题基线，不是通过证据 | 保留为before对照，不得冒充当前通过 | `REUSE_FAILURE_BASELINE` |
| 最终ASR token timing合同 | `46af8eb`后ASR Python、Gateway、contracts全量通过；真实ForcedAligner与283 token timing通过 | 当前新增能力 | 服务器/合同证据有效；不需要重跑已通过的手机音频上传 | `DELTA_SERVER_PASS` |
| continuation后的token timing保留 | HEAD `0779473`；server短门=`90a2a8fb…`，重跑=`945da97a…` | 当前新增能力 | 使用server/API证据，不重复真机9.72文本门 | `DELTA_SERVER_PASS` |
| speaker-first高上下文2人A→B→A | server AliMeeting=`dfc13cbb…`及独立重跑=`7dd249ce…`；exact2、A→B→A、2 parent→4 child、字符守恒、4/4译文 | 当前新增能力 | 两次server真模型证据可复用，不再重复server门 | `DELTA_SERVER_PASS` |
| speaker revision与token timing持久化 | `163c745`后API/Gateway回归；AliMeeting history持久化4 child和完整译文 | 当前新增能力 | API持久化证据已完成，不重跑普通history门 | `DELTA_API_PASS` |
| iOS对新child revision的实际可见呈现 | 复用guest AliMeeting session `7dd249ce…`；API真实返回与源码消费链完成只读验收 | child原先按到达顺序追加；本地修复后API读写、export/review及Flutter history/live按安全timing稳定排序 | 保存fixture已验证A→B→A；无需重播，待构建部署 | `LOCAL_FIX_PASS / NOT_DEPLOYED` |
| AliMeeting术语与数字实体 | 既有设备证据仍有`研讨会/十八到五十`错误 | speaker-first不修ASR词错 | 独立TODO；不得夹带进speaker或continuation重测 | `OPEN_SEPARATE_GATE` |
| 2/4人、快速短轮次、overlap | 旧研究与设备证据不构成当前正式门 | 属于独立speaker覆盖层 | 只有进入该独立任务时才测试；不重复9.72或同一AliMeeting普通门 | `OPEN_SEPARATE_GATE` |

## 本轮重复测试的正式归类

2026-08-30实体iPhone短会话：

- session=`aa15d0f4-489d-41f2-af4f-c15fc3f397a9`；
- fixture=`rt_p0_zh_long_001.wav`，9.722750秒；
- source文本零错、一个逻辑段、speaker_1、翻译完整；
- received/processed/dropped=`257/127/0`；
- ended/finalized与history完整。

该结果与既有`d65f9c43…`真机PASS验证的是同一连续长句能力，不能计为新里程碑。正式状态：

`REDUNDANT_RECONFIRMATION / RESULT_CONSISTENT / NO_NEW_PRODUCT_CLAIM`

它可以保留为运行日志，但后续规划、完成度和发布门不得通过重复次数虚增。

## 当前真正剩余的最小缺口

本轮不再播放9.72秒短句，也不再重复当前server AliMeeting门。

保存记录的child呈现已经通过已有session/API和源码消费链完成零写入验收，原结论为
`FAIL_CHILD_SEGMENT_CHRONOLOGICAL_ORDER`。本地修复现已使用同一保存payload恢复正确ID顺序和A→B→A，并通过API/Flutter
聚焦与全量回归。证据见`docs/poc/wujie-speaker-first-history-ordering-acceptance-2026-08-30.md`。

下一步是构建可追溯候选并用保存fixture做部署后只读复核，不补录或重播同一音频。只有部署代码与本地验证不一致时，才重新打开
对应门。

## 执行规则

1. 每个测试提案先引用旧证据和对应commit/tree。
2. 必须列出使旧证据失效的具体diff；没有diff到功能路径就不重测。
3. setup、连通性探测和服务恢复不得包装为功能验收。
4. 同一fixture、同一功能、同一模型fingerprint的重复运行默认不增加完成度。
5. 失败基线可复用作before对照，但不得冒充PASS。
6. 任何新增真机测试必须由用户明确批准；未经批准保持只读审计。
7. `outputs/`继续不读、不改、不清理、不暂存；研究音频不进入发布资产。
