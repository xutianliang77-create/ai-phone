# Air780 测试运行记录

结果状态只能填写：`PASS / CONDITIONAL / FAIL / BLOCKED / NOT_RUN`。

`source_ready_unverified` 只用于测试矩阵表示测试源码和业务实现已就位，不是本模板的运行结果；
尚未执行的 run 必须填写 `NOT_RUN`，不能从代码审查或产品负责人免复测直接推导出 H3/H4 PASS。

若产品负责人明确免除复测并确认功能通过，项目总览可记录
`USER_ACCEPTED_PASS`，但不得伪造本模板中的 repetitions、measured metrics、录音、PCM 或
H2–H5 artifact；未实际执行的逐项用例仍保留 `NOT_RUN` 及验收人确认来源。

## 1. Run Manifest

| 字段 | 值 |
| --- | --- |
| runId | AIR-YYYYMMDD-HHMMSS-short-id |
| startedAt / endedAt |  |
| operator / reviewer |  |
| testIds |  |
| evidenceLevel | H0/H1/H2/H3/H4/H5 |
| repo branch / commit |  |
| dirty diff SHA-256 |  |
| Beelink identity / OS / kernel |  |
| Air model / board revision |  |
| firmware version / SHA-256 |  |
| USB VID:PID / topology |  |
| SIM carrier / number hash |  |
| LiveKit version / digest |  |
| API/Gateway/Worker/Agent versions |  |
| ASR/MT/TTS fingerprints |  |
| fixture manifest SHA-256 |  |
| Gate 0B marker manifest SHA-256 | 仅 Gate 0B；不含 PCM、号码或录音正文 |
| consent record reference |  |

禁止填写明文手机号、ICCID、IMEI、token、密钥或音频正文。

## 2. Preflight

- [ ] 仓库和 dirty diff 已冻结，`outputs/` 未进入源码快照。
- [ ] 硬件、固件、SIM、owned number、供电和 USB 已核验。
- [ ] LiveKit/API/Gateway/模型地址实时探测且属于隔离 staging。
- [ ] 已冻结业务媒体策略：人工翻译为 `translation_isolated`，AI 代打为
  `agent_monitored`，并记录 App/Gateway 两侧的发布者 admission 快照。
- [ ] 已准备 App 断网重连和 participant 加入/离开场景；每次事件后都采集发布与订阅
  admission 摘要，不能沿用首次入房的权限快照。
- [ ] 系统时间同步；设备、Gateway、LiveKit、对端录音时钟可对齐。
- [ ] 录音和 AI/翻译参与已取得双方同意。
- [ ] 禁拨、白名单、最大时长和紧急停止开关已生效。
- [ ] 旧镜像/固件/配置已保存为可回滚版本。
- [ ] Gate 0B 双 marker 的频率、幅度、采样率、外部扬声器位置、远端捕获格式、相关阈值和
  所有测试窗口已在看结果前冻结；MIC marker 只能经空气进入 Air780 的物理 MIC。

## 3. Test Result

| 字段 | 值 |
| --- | --- |
| testId |  |
| repetitions planned / completed |  |
| status |  |
| measured metrics |  |
| expected threshold |  |
| first failing iteration |  |
| communicationSessionId | 仅内部脱敏引用 |
| deviceId / leaseId | 仅内部脱敏引用 |
| providerCallId | 仅内部脱敏引用 |
| defect / incident ID |  |

## 4. Evidence Index

| Artifact | Path | SHA-256 | Notes |
| --- | --- | --- | --- |
| input PCM/WAV |  |  | sample rate/channel/format |
| local capture |  |  |  |
| peer capture |  |  |  |
| command JSONL |  |  |  |
| device event JSONL |  |  |  |
| VUART frame index |  |  | 不保存密钥 |
| Gate 0B marker summary |  |  | manifest SHA、每窗口 TTS/MIC 检出数、峰值相关、最大 gap；不含 PCM |
| LiveKit events/stats |  |  |  |
| App subscription ACL summary |  |  | track name、publisher binding、退订原因；不含 token |
| VAD/speech-admission summary |  |  | voiced/silence 计数、被阻断 transcript 数；不含文本正文 |
| takeover/hangup binding summary |  |  | participant digest、operation digest、carrier 终态 |
| App error/admission summary |  |  | 错误码和订阅判定；不得包含原始响应正文或 token |
| trace/metrics |  |  |  |
| database snapshot/query |  |  |  |
| redacted logs |  |  |  |

## 5. Deviations and Decision

- 与冻结环境的偏差：
- 对结果的影响：
- 是否需要重跑：
- 回滚动作：
- Gate 判定：`PASS_A / PASS_C / CONDITIONAL / FAIL / BLOCKED`
- Reviewer：
- Reviewed at：

Gate 0B 的 `pass_candidate` 只表示 marker 摘要达到冻结阈值；没有同时完成连续注入、
远端可懂度、清理/断连、VUART sequence、carrier 事件和独立 review 时，不得填写
`PASS_A` 或 `PASS_C`。
