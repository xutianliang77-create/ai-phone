# 无界AI优化任务快照

- 日期：2026-08-02
- 用途：当前执行视图；完整历史仍以 `docs/ai-phone-optimization-development-tasks.md` 为准
- 原则：模型选型、隔离优化、生产迁移和产品验收分开计数

## 已冻结或已验收

| 项目 | 状态 | 当前结论 |
| --- | --- | --- |
| `OPT-ASR-001` ASR 选型 | accepted | 服务器/多语种主 ASR 固定为 Qwen3-ASR 1.7B；不再赛马 |
| `OPT-VAD-001` MarbleNet 主 VAD | accepted | 继续作为现有声学前端基线 |
| `OPT-RT-002/003` finalize 与字幕组装 | accepted | 异常结束、断句、去重和强制输出基线保留 |
| `OPT-RT-005` 当前整段 TTS 队列 | accepted | 流式候选未过连续追加播放门，保持关闭 |
| `OPT-SPK-005` speaker 边界基础 | accepted | 固定 `min_duration_on=100ms` 与跨确认边界字幕拆分 |
| `OPT-DEP-001/003` 两层拓扑 | accepted | 手机直连服务器；不引入 Mac 运行依赖 |

## 当前优化队列

下表最多保留 10 条可执行产品任务；每轮只拆一个边界明确的批次，避免把 ASR、speaker、
UI、TTS 和 Agent 架构改动混在同一回归里。

| 顺序 | 任务 | 当前状态 | 下一道硬门 |
| ---: | --- | --- | --- |
| 1 | `OPT-ASR-002` 已选 Qwen 链路质量与延迟 | in_progress，隔离评测 | 声学/VAD、稳定可读 partial、endpoint、静音幻觉、实体/术语和 revision 分层通过；生产迁移另批批准 |
| 2 | `OPT-SPK-009` 真实声学 slot/cardinality 稳定性 | todo | 同一多人素材多轮 A/B：同人复用、异人不误合并、匿名槽位数量稳定 |
| 3 | `OPT-SPK-010` `speakerCount` 呈现口径 | code-ready，CPU 回归通过，未部署 | 用真实 unknown-only 与 2人+unknown 历史会话真机核对人数呈现；诊断仍保留 unknown |
| 4 | `SPK-008-A` 真人多人/混合语种 | in_progress | 3–4 人、中英夹杂、短轮次、overlap/unknown 真机门；不降低 Sortformer 阈值 |
| 5 | `OPT-RT-004` 尾句可靠性 | todo，代码已有 | 真实 Qwen+Hy-MT2 下结束 100 次，原文和译文保存率均不低于 99% |
| 6 | `OPT-VAD-003` 分模式 endpoint | in_progress，600ms 仅候选 | canonical 大集、真实 pacing、真机、生产负载和回滚门全部通过后才可部署 |
| 7 | `OPT-LLM-001/002` + `OPT-TERM-001` 受控纠错 | in_progress | 独立未见控制集证明有修复、零错短句不变、数字/拉丁实体无新增错误，并记录 revision 到达时间 |
| 8 | `OPT-UI-001~005` 长会话、连接状态与发布呈现 | code-ready/in_progress；失败状态与字幕隔离，连接/余额 live-region 及 320dp/200% 字体已过 CPU 回归 | 小屏、横屏、深色、VoiceOver/TalkBack、长会话和真实 Profile/Release 截图 |
| 9 | `OPT-UI-006/007` 记录产品验收 + “我的”发布身份 | in_progress/code-ready；记录错误恢复、发布身份及账号返回刷新已过 CPU 回归 | 两步内进入纪要/全文/术语/待办；真实分享面板；Profile 页面、bundle、诊断版本一致；真机登录/退出返回状态正确 |
| 10 | `OPT-SCAN-001` 扫描目标语言与复杂版面 | 主链路通过；目标语言、4×4表格碰撞、宽度字号、极端堆叠回退及缩放控件保留区已过CPU回归 | 真机换向状态正确；真实菜单、表格、斜拍及长短译文视觉验收通过 |

## 暂不进入当前冲刺

- `OPT-ASR-003` FireRedASR2-AED 官方复测：**TODO / 等待共享 GPU 安全窗口**。
  仅跑已冻结的中英 2+2 smoke4，不跑 formal、不改生产服务和 Qwen 主 ASR 选型；
  旧任务已有256项合成TTS代理结果，但旧runtime使用`strict=False`且61ms是batch8均摊
  段后decode，所以本TODO改为官方源码/权重兼容性与canonical可比复核。官方 AED
  无原生 partial/token，通过 batch 门也只能作为 second-pass/revision 候选。
- Qwen Audio Agent 借鉴任务 `ARC-VOICE-*`：设计已完成，仍是 TODO；只补无界AI不足，
  不改写现有 LiveKit/ASR/MT/TTS 优点，不另建 realtime gateway。
- 真实 SIP/Agent/Egress、支付、企业版和 Android 独立评测。
- TTS 流式替换：当前整段播放继续使用；连续 append、缓存和无缝真机门通过前不切换。
- 除 `OPT-ASR-003` 的一次冻结确认外，任何新的 ASR 候选下载或扩测；重开条件见
  `docs/asr-selection-decision-2026-08-02.md`。

## 推荐执行顺序

先完成 `OPT-ASR-002` 的一个单变量隔离合同，再做 `OPT-SPK-009/010 + SPK-008-A`；
随后收口 `OPT-RT-004/OPT-VAD-003`，最后统一跑 UI、记录、扫描与发布呈现真机验收。
每项失败只回退该 feature/config，不回退已验收主链。
