# Beelink Sortformer 说话人分离 Shadow 评测报告

日期：2026-07-11
结论：**stateful v2 短语料、加速和真实墙钟稳定性门禁通过；Gateway 继续关闭，等待真人多人门禁**

## 1. 运行环境

- 主机：Beelink，Ubuntu 24.04，RTX 5090 32 GB
- 独立 runtime：`/data/models/translation-model-eval/.venv-speaker`
- Python：3.12.3
- PyTorch：2.11.0+cu130
- NeMo：2.7.3
- 模型：`nvidia/diar_streaming_sortformer_4spk-v2.1`
- 本地模型：`/data/models/translation-model-eval/models/sortformer/diar_streaming_sortformer_4spk-v2.1.nemo`
- 模型 SHA-256：`8abd32832159c6ac1148c926b7276f35ba34582c444e559dce1f1253fea42ef8`
- Shadow 服务：`0.0.0.0:8022`，与 ASR、翻译和 TTS runtime 隔离

## 2. 门禁

| 项目 | 门槛 |
| --- | --- |
| 普通固定语料 DER | 不高于 20% |
| 30 分钟语料 DER | 不高于 18% |
| 30 分钟稳定 speaker 数 | 不超过 4 |
| 30 分钟标签漂移 | 0 次 |

## 3. 固定语料结果

| 场景 | DER | Miss | False alarm | Confusion | 结果 |
| --- | ---: | ---: | ---: | ---: | --- |
| 双人轮流说话 | 4.64% | 0.42% | 4.23% | 0.00% | 通过 |
| 1.2 秒连续切换 | 60.33% | 0.00% | 10.33% | 50.00% | **失败** |
| 双人重叠 | 5.47% | 3.05% | 2.42% | 0.00% | 通过 |
| 四人轮流说话 | 5.67% | 0.06% | 5.61% | 0.00% | 通过 |
| 30 分钟离线 | 5.61% | 3.27% | 2.34% | 0.00% | 通过 |

该表是首次运行记录，不能继续作为模型淘汰依据。复核发现：

- runner 和 shadow engine 使用的是官方 30.4 秒输入缓冲档
  `chunk_len=340/chunk_right_context=40`，不适合实时抢话验收。
- shadow engine 每次调用 `diarize()` 都会重建 NeMo AOSC/FIFO 状态；120 秒
  滚动窗口加自定义标签映射不等价于原生连续流式推理。
- 快速切换语料把每个 speaker 的同一段 1.2 秒波形原样重复 10 次，会干扰
  speaker cache，不能代表自然对话。
- 换成官方 1.04 秒低延迟配置后，旧重复语料 DER 从 60.33% 降至 37.58%。
- 换成每轮不同内容、单轮 0.48 至 1.10 秒的自然短句后，低延迟配置 DER 为
  14.96%，Confusion 为 0，达到 20% smoke 门槛。

因此当前问题主要来自流式接入、参数和固定语料设计，而不是已经证明模型存在
1.2 秒硬能力上限。正式门禁必须使用自然多句语料、RTTM、官方 NeMo 评分和
原生持久化 streaming state 重跑。

## 4. 30 分钟 HTTP Shadow

- 输入时长：1,798 秒
- 发送帧：1 秒 PCM16 帧
- 推理间隔：10 秒（加速 shadow）
- 滚动上下文：120 秒
- 输出区间：587
- 稳定 speaker：4
- 标签漂移：0
- DER：5.44%
- Miss：3.28%
- False alarm：2.17%
- Confusion：0.00%
- 加速回放墙钟时间：26.65 秒
- 实时节拍墙钟时间：1,798.24 秒
- 实时节拍结果：DER 5.44%，稳定 speaker 4，标签漂移 0
- 服务进程：全程 PID 未变，无重连、请求错误或模型重载
- 服务 RSS：从 2,381,736 KiB 增至 2,386,292 KiB，增加约 4.45 MiB

实时节拍使用 1 秒 PCM16 帧，并按音频时间戳等待后发送下一帧；因此它同时
验证了 30 分钟时间轴和 30 分钟持续墙钟运行，不是只做加速离线推理。

初次运行曾出现滚动边界漏段和第 5 个 speaker ID。修复方式是对跨稳定边界
的 span 做裁剪并严格限制 session 的 speaker 槽位；修复后 30 分钟 shadow
由 DER 22.91% 降至 5.44%，且不再产生第 5 个 ID。

## 5. 发布判断

当前只允许保持 `sortformer_shadow` 独立服务运行和收集评测证据。
Gateway 的 `SPEAKER_PROVIDER` 必须保持 `off`；独立 shadow 服务可继续运行评测。

在完成原生低延迟 stateful streaming、修复 Gateway span 保存/对齐，并用有效
语料重跑全部门禁之前，不执行：

- iPhone 双人身份归属验收
- 快速抢话与重叠验收
- 四人稳定标签验收
- 历史记录说话人重命名验收
- 带说话人的会议纪要导出验收

## 6. Stateful low-latency v2 复测

已完成的实现修正：

- 每个 session 持久化 NeMo AOSC/FIFO streaming state，不再重复调用会重置状态的 `diarize()`。
- 采用官方低延迟 profile：`chunk=6`、`left=1`、`right=7`、`fifo=188`、`update=144`、`cache=188`。
- 手机 24 kHz PCM 使用连续 soxr stream 转成 16 kHz；16 kHz 和 24 kHz 输出边界完全一致。
- 持续说话时返回 `final=false` 临时 span，闭合或 flush 后按相同 key 替换为最终 span。
- Gateway 即使 ASR 当前返回空也保存 speaker span；对齐改为按 speaker 聚合并合并重复时间区间。

候选测试完成后已将最终实现部署到 `0.0.0.0:8022`；Gateway 仍为 `off`。

| 项目 | 结果 |
| --- | ---: |
| 自然短句 24 kHz raw DER | 14.49% |
| 自然短句 250ms collar DER | 0.00% |
| 自然短句 Confusion | 0.00 秒 |
| 首个临时 speaker evidence | 1.12 秒音频 |
| speaker evidence latency P95 | 1.12 秒 |
| 30 分钟加速 raw DER | 15.33% |
| 30 分钟加速 250ms collar DER | 0.00% |
| 30 分钟加速 Confusion | 0.00 秒 |
| 30 分钟稳定 speaker 数 | 2 |
| 30 分钟加速处理墙钟 | 37.79 秒 |
| 30 分钟实时处理墙钟 | 1,807.34 秒 |
| 30 分钟实时 HTTP 5xx | 0 |
| candidate 服务 PID | 全程未变化 |

自然短句的 raw DER 全部来自模型把 120ms 人工静音连接到相邻 speech span；
250ms collar 后错误为 0，且没有 speaker confusion。30 分钟输入由自然短句集循环构成，
只用于验证状态、标签和进程稳定性，不能替代真人中文、中英混说、噪声、重叠和四人质量门禁。

正式启用前剩余：

1. 使用真人双人、抢话、重叠和四人 RTTM 录音运行相同 pyannote 门禁。
2. 通过后仅在测试 Gateway 开启 `SPEAKER_PROVIDER=http`。
3. 最后执行 iPhone 字幕、历史重命名、纪要和导出验收。

额外集成结果：

- 空会话先 flush 后开始送帧，不发生时间轴偏移。
- `发送 -> flush -> 60 秒时间戳跳变 -> 继续发送` 正常，恢复片段从 60000ms 开始。
- 两个 session 交错送入同一模型时均输出 7 个相同边界片段，AOSC/FIFO 状态没有串会话。
- Beelink 持久化目录统一为 `/data/models/translation-model-eval`；评测工具位于其 `tools/` 子目录。
