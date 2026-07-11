# Beelink Sortformer 说话人分离 Shadow 评测报告

日期：2026-07-11
结论：**未达到 Gateway 启用门禁**

## 1. 运行环境

- 主机：Beelink，Ubuntu 24.04，RTX 5090 32 GB
- 独立 runtime：`/data/models/translation-model-eval/.venv-speaker`
- Python：3.12.3
- PyTorch：2.11.0+cu130
- NeMo：2.7.3
- 模型：`nvidia/diar_streaming_sortformer_4spk-v2.1`
- 本地模型：`/data/models/translation-model-eval/models/sortformer/diar_streaming_sortformer_4spk-v2.1.nemo`
- 模型 SHA-256：`8abd32832159c6ac1148c926b7276f35ba34582c444e559dce1f1253fea42ef8`
- Shadow 服务：`127.0.0.1:8022`，与 ASR、翻译和 TTS runtime 隔离

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

1.2 秒切换语料被模型判为一个持续 speaker。将 onset/offset 从默认 0.5
依次降到 0.4、0.3、0.2 和 0.1 后，第二 speaker 只在少量短区间激活，第一
speaker 仍覆盖全程，无法达到 DER 门槛。因此不能通过调低阈值上线。

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
- 加速执行墙钟时间：26.65 秒

初次运行曾出现滚动边界漏段和第 5 个 speaker ID。修复方式是对跨稳定边界
的 span 做裁剪并严格限制 session 的 speaker 槽位；修复后 30 分钟 shadow
由 DER 22.91% 降至 5.44%，且不再产生第 5 个 ID。

## 5. 发布判断

当前只允许保持 `sortformer_shadow` 独立服务运行和收集评测证据。
Gateway 的 `SPEAKER_PROVIDER` 必须保持 `off`；独立 shadow 服务可继续运行评测。

在 1.2 秒切换门禁通过或经产品评审重新定义“抢话”验收语料之前，不执行：

- iPhone 双人身份归属验收
- 快速抢话与重叠验收
- 四人稳定标签验收
- 历史记录说话人重命名验收
- 带说话人的会议纪要导出验收
