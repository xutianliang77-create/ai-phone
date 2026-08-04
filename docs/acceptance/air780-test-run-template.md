# Air780 测试运行记录

结果状态只能填写：`PASS / CONDITIONAL / FAIL / BLOCKED / NOT_RUN`。

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
| consent record reference |  |

禁止填写明文手机号、ICCID、IMEI、token、密钥或音频正文。

## 2. Preflight

- [ ] 仓库和 dirty diff 已冻结，`outputs/` 未进入源码快照。
- [ ] 硬件、固件、SIM、owned number、供电和 USB 已核验。
- [ ] LiveKit/API/Gateway/模型地址实时探测且属于隔离 staging。
- [ ] 系统时间同步；设备、Gateway、LiveKit、对端录音时钟可对齐。
- [ ] 录音和 AI/翻译参与已取得双方同意。
- [ ] 禁拨、白名单、最大时长和紧急停止开关已生效。
- [ ] 旧镜像/固件/配置已保存为可回滚版本。

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
| LiveKit events/stats |  |  |  |
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
