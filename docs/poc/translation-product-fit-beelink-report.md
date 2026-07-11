# Beelink 翻译模型产品适配评测报告

日期：2026-07-05

## 结论

本轮推荐顺序：

1. `tencent/Hy-MT2-1.8B`：国内版服务端翻译主模型。
2. `google/madlad400-3b-mt`：多语种扩展候选，效果好但模型大。
3. `NiuTrans/LMT-60-0.6B`：低成本、低显存兜底，需前置分句和格式保护。
4. `facebook/seamless-m4t-v2-large`：研究对照，不作为商业默认。
5. `tencent/Hy-MT2-1.8B-GGUF Q4`：已下载，缺兼容 llama.cpp/STQ runtime，暂未进入质量排名。
6. `NiuTrans/LMT-60-1.7B-Base`：本轮不推荐，Base 版本直接吃指令会复读 prompt。

当前产品建议：服务端/通话翻译使用 `Hy-MT2-1.8B` 作为自部署主模型；`qwen-plus` 保留为复杂上下文、摘要和 AI Agent 文本生成的质量兜底。

## 环境与约束

- 机器：Beelink
- 远端根目录：`/data/models/translation-model-eval`
- 本轮数据目录：`/data/models/translation-model-eval/data/translation-product-fit`
- 本地缓存：`.cache/model-eval/translation-product-fit`
- GPU：RTX 5090 32GB
- 显存约束：本轮单模型 `max_memory={0: "9GiB", "cpu": "80GiB"}` 仅用于防止评测挤占机器；显存占用不作为产品发布门禁。
- 执行策略：逐模型加载、测试、卸载，再启动下一个模型。

本轮评测最大 torch GPU 显存：

| 指标 | 结果 |
| --- | --- |
| 最大加载后显存 | `6640MB` |
| 最大推理后显存 | `6640MB` |
| 最大卸载后残留 | `9MB` |
| 是否超过 10GB | 否，仅作容量规划参考 |

## 下载清单

所有被测模型均已保存在 `data/translation-product-fit/models/`，无 `.download` 残留。

| 模型目录 | 仓库 | 大小 |
| --- | --- | ---: |
| `hymt2_1_8b` | `tencent/Hy-MT2-1.8B` | 4.09GB |
| `hymt2_1_8b_gguf_q4` | `tencent/Hy-MT2-1.8B-GGUF` | 1.13GB |
| `lmt_60_0_6b` | `NiuTrans/LMT-60-0.6B` | 1.52GB |
| `lmt_60_1_7b_base` | `NiuTrans/LMT-60-1.7B-Base` | 4.08GB |
| `madlad400_3b_mt` | `google/madlad400-3b-mt` | 11.78GB |
| `seamless_m4t_v2_large` | `facebook/seamless-m4t-v2-large` | 9.26GB |

## 测试集

共 12 条样本，覆盖：

- 中译英短句、英译中短句。
- 中文长句、英文客服/会议句。
- 中英混合自动方向。
- ASR 脏输入：无标点、重复片段。
- 领域词：SKU、金额、地址、人名、电话。
- 格式保护：JSON 字段、字幕分隔符。

评分方式：自动规则评分，检查目标语种、关键词、保护词、是否额外解释。该评分适合产品适配筛选，不替代真人语义评分。

## 评测结果

| 排名 | 模型 | 通过 | P50 | P95 | 最大显存 | 卸载后 | 结论 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | `Hy-MT2-1.8B` | 12/12 | 152ms | 303ms | 3424MB | 8MB | 服务端翻译主模型 |
| 2 | `MADLAD400-3B-MT` | 11/12 | 248ms | 373ms | 6640MB | 8MB | 多语种扩展强 |
| 3 | `SeamlessM4T v2 large` | 10/12 | 172ms | 220ms | 4447MB | 9MB | 研究对照，非商业默认 |
| 4 | `LMT-60-0.6B` | 8/12 | 141ms | 328ms | 1146MB | 8MB | 低成本兜底 |
| 5 | `LMT-60-1.7B-Base` | 0/12 | 1630ms | 1718ms | 3290MB | 8MB | 不推荐 |
| - | `Hy-MT2-1.8B-GGUF Q4` | 未跑 | - | - | - | - | 缺兼容 runtime |

## 模型分析

### Hy-MT2-1.8B

本轮表现最好，12 条全通过。中英短句、长句、混合语种、JSON 字段和字幕分隔符都稳定，延迟也低。适合作为国内版服务端自托管翻译主模型。

风险：当前只跑了 12 条产品适配样本，还需要追加真实 ASR 输出、电话场景和长会话上下文。

### MADLAD400-3B-MT

多语种能力强，12 条通过 11 条，延迟可接受。失败样本是 ASR 脏输入长中文句，译文可懂但表达机械。

建议：作为未来多语种扩展候选，不优先替代 Hy-MT2 做中英同传。

### SeamlessM4T v2 large

文本翻译速度快，10/12 通过。失败点集中在领域术语和分隔符保留，例如 `||` 字幕分隔符未保留。

建议：作为语音/文本一体模型研究对照，不进入商业默认链路。

### LMT-60-0.6B

显存最低，速度快，普通短句可用。失败集中在中英混合、JSON 格式保护和部分关键词规则。

建议：保留为低成本兜底，但前面必须加分句、语言识别、去重和格式保护。

### LMT-60-1.7B-Base

Base 版本直接复读 prompt，12 条全失败。

建议：不要用 Base 版做产品翻译。若继续 LMT 1.7B 路线，应测试 `NiuTrans/LMT-60-1.7B` 非 Base 版本。

### Hy-MT2-1.8B-GGUF Q4

模型已下载，`Hy-MT2-1.8B-Q4_K_M.gguf` 完整存在。当前 Beelink 只有 `ollama`，没有兼容 Hy-MT2 GGUF 所需的 llama.cpp/STQ runtime，因此未做质量评分。

建议：后续单独安装兼容 `llama.cpp` STQ kernel 后再测端侧/边缘低资源部署。

## 产品建议

| 场景 | 推荐 |
| --- | --- |
| 中英实时同传自托管 | `Hy-MT2-1.8B` |
| 通话翻译 | `Hy-MT2-1.8B` + qwen-plus 兜底 |
| 多语种扩展 | `MADLAD400-3B-MT` |
| 低成本私有部署 | `LMT-60-0.6B`，但必须做前置清洗 |
| 研究对照 | `SeamlessM4T v2 large` |
| 暂不推荐 | `LMT-60-1.7B-Base`、`Hy-MT2 GGUF Q4` |

下一步执行顺序：

1. 部署 `services/model-services/translation-service` 到 Beelink/生产环境，使用 `TRANSLATION_SERVICE_PROVIDER=hymt2` 加载 Hy-MT2。
2. 用 `npm run check:translation-provider -- --provider hymt2_self_hosted --json` 跑真实 smoke。
3. 使用真实 iPhone ASR 输出、电话带宽转写和历史会议记录扩展到 100-300 条样本。
4. 加入真人抽检，重点看术语、人名、地址、金额和混合语言。
5. 如要端侧/边缘部署，再单独处理 Hy-MT2 GGUF runtime。

## 产物

远端：

- `/data/models/translation-model-eval/data/translation-product-fit/samples.jsonl`
- `/data/models/translation-model-eval/data/translation-product-fit/download-inventory.json`
- `/data/models/translation-model-eval/data/translation-product-fit/outputs/generation-results.json`
- `/data/models/translation-model-eval/data/translation-product-fit/outputs/score-summary.json`
- `/data/models/translation-model-eval/data/translation-product-fit/outputs/error-cases.jsonl`

本地：

- `.cache/model-eval/translation-product-fit/samples.jsonl`
- `.cache/model-eval/translation-product-fit/download-inventory.json`
- `.cache/model-eval/translation-product-fit/generation-results.json`
- `.cache/model-eval/translation-product-fit/score-summary.json`
- `.cache/model-eval/translation-product-fit/error-cases.jsonl`

模型来源：

- https://huggingface.co/tencent/Hy-MT2-1.8B
- https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF
- https://huggingface.co/NiuTrans/LMT-60-0.6B
- https://huggingface.co/NiuTrans/LMT-60-1.7B-Base
- https://huggingface.co/google/madlad400-3b-mt
- https://huggingface.co/facebook/seamless-m4t-v2-large
