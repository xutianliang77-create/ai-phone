# 无界AI ASR 选型决策记录

- 日期：2026-08-02
- 状态：**Accepted / 选型冻结**
- 决策范围：无界AI服务器在线、多语种、聆听与会议模式的主 ASR 模型族
- 不包含：当前生产端口/服务是否已迁移、iOS 离线 ASR、Android 独立选型

## 1. 决策

无界AI服务器主 ASR 固定为 **`Qwen/Qwen3-ASR-1.7B`**。后续不再把
Whisper、Nemotron、Parakeet、Moonshine、VibeVoice-ASR、Fun-ASR Nano/MLT、
FireRedASR2 或 sherpa-onnx Zipformer 作为当前选型队列继续赛马。

选型冻结不等于已经切换生产路由。任何端口、模型 revision、runtime、服务或 App
配置的迁移，仍须在当次操作前实时探测，建立可验证回滚点，并通过隔离 smoke、真实
pacing、真机和回归门后单独批准。

## 2. 产品模式映射

| 场景 | 固定策略 | 边界 |
| --- | --- | --- |
| 同传 | Qwen3-ASR 1.7B 作为服务器初稿与 final ASR | 优先低延迟；不得让通用 LLM 自由改写原文 |
| 聆听 | Qwen3-ASR 1.7B 初稿 + 受控段后 LLM/MOSS revision | `raw ASR` 永久可追溯；revision 通过门禁后才可提升为展示修订 |
| 会议 | Qwen3-ASR 1.7B 初稿 + 受控段后 revision + 独立 speaker 链 | speaker 继续使用 Sortformer/TitaNet；MOSS 的 Sxx 仅是单录音匿名标签 |
| Call Link | Qwen3-ASR 1.7B；优先使用 participant track 归属说话人 | 不用文本规则伪造 speaker；overlap/unknown 必须可回退 |
| 手机离线 | 保留既有 iOS CoreML/Nemotron 兜底 | 本决策不替换端侧链路；Android 另行真机评测 |

段后 revision 的固定保护门为：零错短句不得变差；数字、金额、人名、拉丁实体和专业
术语不得被新增或改写；异常 speaker 分裂和 overlap 不确定时回退 raw；修订必须保存
`raw/revised/provider/reason/latency`，不能覆盖原始识别证据。

## 3. 选型证据摘要

所有模型横评均来自 Beelink canonical 隔离根，不以 Mac 性能或生产 App 临时表现替代：

`/data/models/translation-model-eval/data/unified-multilingual-eval`

首批 ASR source manifest 为
`fixtures/asr-benchmark-v1/manifest.asr-benchmark-v1.jsonl`，270 条，SHA-256
`969ef77c02da3430122ea8fb0e97f3307542096943798780df34555612d4308c`。其中
AliMeeting overlap 10 条只作诊断，不并入普通 CER 或总分。

2026-08-03 已在同一canonical root冻结后续统一评测入口
`experiments/asr-complete-suite-v1-20260803/fixture/manifest.asr-complete-suite-v1.jsonl`，
343条唯一音频，SHA-256
`9acfdb07c8b3c2918bc0ec2ef1571dba3561e50c369e7a9f6419dae7a8d008db`。它保留
12语种×10、LibriSpeech clean/other各50、AliMeeting 40+10，并增加MInDS-14电话18、
ASCEND真实中英混说10、MUSAN 20/10/5dB共18及内部诊断27；先跑冻结smoke12，再按场景
扩测并分别报告，不生成全局聚合总分。TALCS因官方授权需实名并显式接受协议而未纳入，
不得宣称已覆盖。

已复核的关键证据：

- 同一 AliMeeting far-field 40 条，Qwen3-ASR 1.7B CER `5.122%`，40/40 成功、
  空白/重复/幻觉代理均为 0；Nemotron CER `17.967%`，Qwen3-ASR 0.6B 同行基线
  CER `26.556%`。overlap 10 条仍仅作诊断。
- Qwen3-ASR 1.7B 多语稳定可读 partial v7 在既有 8 条困难开发子集上，将 p50/p95
  从 `3575.732/5068.087ms` 降到 `2753.653/4242.775ms`，8/8 前缀保留，错误
  文字系未提升。该结果只支持隔离开发，**不构成生产验收**。
- v8、v9、v10 与 shadow-midpoint 分支均因语言锁、保留、主轨隔离或收益门失败而
  NO-GO；当前研究基线固定为 v7 的 `unfixed_chunk_num=7 + 200ms`。
- sherpa-onnx 双语 Zipformer smoke4 的英文 WER `66.67%`、blank `1/4`、稳定前缀
  仅 `2/4` 保留，已关闭；不再据此重开 ASR 选型。
- FireRedASR2-AED 官方 fp32/beam3/batch1 中英 2+2 smoke4 为 4/4 成功，中文
  CER `3.03%`、英文 WER `7.69%`，音频结束到 final p50/p95 为
  `273.7/349.6ms`，checkpoint 零 missing/unexpected；但官方 AED 无原生
  partial/token，实时主 ASR NO-GO，仅保留为另冻合同的 second-pass/revision 信号。
- Auto语言路由v2 CPU合同已通过：可靠中文或英文LID进入中英放行模式，其他10个核心
  语言进入单语锁，拉丁文字不作为LID证据。12语主集路由为中文/英文20条放行、其他语种
  100条单语，真实中英混说10/10放行；这只证明状态转换，不证明真实音频LID已校准。
  生产实装前必须在同一12语真实音频上报告置信度、首次可靠锁定时间、其他语种误放行率
  和锁后抖动。

证据入口：

- `/Users/xutianliang/Downloads/翻译软件app/data/asr-eval-prep/asr-replacement-ab-v1/results-20260723/qwen17-formal-summary.json`
- `/Users/xutianliang/Downloads/翻译软件app/data/asr-eval-prep/asr-replacement-ab-v1/results-20260723/nemotron-formal-summary.json`
- `/Users/xutianliang/Downloads/翻译软件app/data/asr-eval-prep/qwen17-multilingual-adaptive-v7/REPORT.md`
- `/Users/xutianliang/Downloads/翻译软件app/data/asr-eval-prep/native-partial-bilingual-zipformer-smoke-v1/REPORT.md`
- `/Users/xutianliang/Downloads/翻译软件app/data/asr-eval-prep/qwen17-code-switch-entity-v1/AUTO_LANGUAGE_ROUTING_REPORT.md`
- Beelink `data/unified-multilingual-eval/experiments/fireredasr2-confirmation-smoke-v1-20260802/SMOKE_REPORT.md`

Qwen3-ASR 1.7B 本轮隔离模型树 fingerprint：
`94aae61721c6e49bd57b8423488bdf1031cb19cc9a6fdd60db18e6d6ef22deb7`。

## 4. 后续只优化已选链路

后续 ASR 工作按以下顺序执行，不再开展无门槛的模型赛马：

1. 真实声学前端/VAD：低音量、静音、远场、重叠、8k 电话和 MUSAN 分层。
2. 首个稳定、可读 partial：以可读、可保留和正确文字系为门，不追逐首个非空字符。
3. endpoint：按同传、聆听、会议、Call Link/PSTN 分模式，保持尾句完整和可回滚。
4. 静音幻觉、重复和空白率。
5. 数字、金额、姓名、拉丁实体及专业术语保留。
6. 段后 revision 的修复率、新增错误率和到达时间。
7. 真实设备、真实 pacing、长会话和生产负载验收。

## 5. 重开选型条件

只有满足以下任一条件，才允许创建新的 ASR 选型任务：

- 用户明确要求重开；或
- 出现许可可用于目标发布场景、支持中英文及目标多语种、具备可验证 partial，并在同一
  冻结 smoke 合同同时超过 Qwen3-ASR 1.7B 准确率与稳定可读延迟门的新 checkpoint。

重开时仍必须先 smoke；中文或英文任一核心门失败即停止，不扩 zh10/en10、AliMeeting
far-field 40、12 语种或生产链路。

2026-08-03 已按用户释放的 GPU 窗口完成 `OPT-ASR-003` 官方中英 2+2 冻结
smoke4；未跑 formal、未改生产服务，也未改变 Qwen3-ASR 1.7B 主 ASR 决策。
batch-final 质量与尾延迟门全部通过，但因无原生 partial/token，结论为
`NO_GO_MAIN_ASR_BATCH_SECOND_PASS_ONLY`，本次确认任务关闭。
历史任务`019f2378-979b-7b40-b497-897752639718`中的FireRed运行仅为MOSS-TTS合成音频
可懂度代理：256项的平均错误率9.76%、中文14.69% CER、英文4.84% WER；其
61ms为`beam1 + batch8`均摊段后decode，且旧加载器使用`strict=False`。该证据证明模型
曾经运行，但不是官方当前runtime、canonical真实语音、首partial或生产验收。

## 6. 隔离与发布边界

- 研究/非商用数据只可用于隔离评测，不进入发布资产。
- 不写入或提交生产仓 `outputs/`。
- 模型服务、GPU、部署和真机操作前必须重新实时探测；历史 health 不作当前证据。
- 所有地址和模型路由保持可配置；未经用户要求不 push。
