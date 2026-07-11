# Qwen3-ASR-0.6B CoreML iPhone14 测试任务与计划

日期：2026-07-08

## 1. 目标

验证 `FluidInference/qwen3-asr-0.6b-coreml` 是否适合作为 iPhone 14 端侧 ASR 候选，并与当前 `CoreML/Nemotron 2240ms`、`Apple Speech`、服务端 `Qwen3-ASR-0.6B original tuned v3 fixed score` 对比。

结论：已淘汰。`int8` 真机链路能录音并进入 decoder，但最终输出为重复符号乱码，延迟过高；手机沙盒模型已删除以释放空间，`coreml_qwen3_asr` 不再进入测试队列，`f32` 不继续 stage。

本计划只针对独立测试 App：

```text
test-apps/iphone14_model_tester
```

不得修改、编译或安装主 App，除非用户在当轮明确授权。

## 2. 测试范围

| 项目 | 内容 |
| --- | --- |
| 模型仓库 | `FluidInference/qwen3-asr-0.6b-coreml` |
| Provider ID | `coreml_qwen3_asr` |
| 首测模型 | `qwen3_asr_0_6b_coreml_int8` |
| 精度基线 | `qwen3_asr_0_6b_coreml_f32` |
| 设备 | iPhone 14 真机 |
| App | 独立测试 App `com.translationlab.iphone14ModelTester` |
| 测试集 | `data/model-eval/iphone14-small-models/iphone14-test-set-v1.jsonl` |
| 结果目录 | `data/model-eval/iphone14-small-models/results/device-pulls/single` |

## 3. 任务清单

| ID | 任务 | 产物 | 验收标准 | 状态 |
| --- | --- | --- | --- | --- |
| Q3C-00 | 确认模型仓库结构、文件大小、最低 iOS/CoreML 要求 | 模型结构记录 | 明确 `int8/`、`f32/` 文件清单和 tokenizer/config 依赖 | 完成 |
| Q3C-01 | 下载 `int8/` 到本地缓存 | 本地模型目录 | 无 LFS pointer；关键 `.mlmodelc/.mlpackage`、tokenizer/config 存在 | 完成 |
| Q3C-02 | 编写 Qwen3 CoreML stage 脚本 | `scripts/iphone14_stage_qwen3_asr_coreml_model.mjs` | 支持 `--variant int8/f32`、`--dry-run`、USB push 到测试 App 沙盒 | 完成 |
| Q3C-03 | 在独立测试 App 增加 Provider Catalog 项 | Dart Provider 配置 | `IPHONE14_MODEL_PROVIDER=coreml_qwen3_asr npm run iphone14:eval -- status` 可显示 Provider | 完成 |
| Q3C-04 | 增加 Native 诊断 Provider | Swift diagnostics | 未 stage 模型时不闪退，JSONL 输出缺失原因 | 完成 |
| Q3C-05 | 接入 Qwen3 CoreML 推理 Provider | Swift provider | 能启动、停止、flush，并输出统一 `speech` 事件 | 终止：int8 输出乱码且延迟过高 |
| Q3C-06 | 安装独立测试 App 到 iPhone 14 | 真机测试 App | App 可启动，Provider 可选择，权限正常 | 完成 |
| Q3C-07 | Stage `int8/` 模型到测试 App | 手机沙盒模型目录 | 诊断显示 modelReady=true | 完成 |
| Q3C-08 | 三条 smoke 测试 | JSONL + 控制台结果 | `zh_short_001`、`en_short_001`、`mixed_001` 不闪退且有 final | 终止：首条 smoke final 为乱码 |
| Q3C-09 | P0 全量 27 条 ASR 测试 | 单条 JSONL 结果 | 每条都有 provider/model/runId/latency/最终文本 | 取消 |
| Q3C-10 | 生成汇总报告 | `summary.json`、`summary.md` | 汇总 CER/WER、通过数、分组结果、延迟、错误事件 | 取消 |
| Q3C-11 | 如 `int8` 通过 smoke，再测 `f32/` | f32 结果 | 明确精度提升是否值得 2.5GB 包体 | 取消 |
| Q3C-12 | 更新模型横评表和推荐结论 | 横评文档 | 明确是否继续产品化、保留研究或放弃 | 完成：淘汰 |

## 3.1 执行记录：2026-07-08

- 已确认 Hugging Face 仓库结构：`int8/` 包含 `qwen3_asr_audio_encoder.mlmodelc`、`qwen3_asr_audio_encoder_v2.mlmodelc`、`qwen3_asr_decoder_stateful.mlmodelc`、`qwen3_asr_embeddings.bin`、`metadata.json`、`vocab.json`；不含可直接复用的公开 Swift runtime。
- `int8` 实际下载体积约 1.6GB；本地缓存位置：`.cache/ios-qwen3-asr-coreml/FluidInference--qwen3-asr-0.6b-coreml/int8`。
- 已安装独立测试 App release 版到 iPhone 14 Pro，bundle id：`com.translationlab.iphone14ModelTester`。
- 已 stage `int8` 到手机沙盒：`Documents/Models/Qwen3ASRCoreML/int8`，设备文件列表显示 28 个条目、三块权重和 embeddings 均存在。
- 公开 `FluidInference/FluidAudio` 当前 main 和测试 App 锁定版本均未发现 `Qwen3AsrManager` / Qwen3 runtime；因此当前只能做文件级诊断，不能完成真实 `speech` 输出。
- 曾出现 debug build 闪退，崩溃日志位于 `data/model-eval/iphone14-small-models/results/crashlogs/Runner-2026-07-08-085620.ips`；release 安装后未出现新的 09 点崩溃日志，进程仍在。
- 后续接入历史 Qwen3 runtime 后，`cpuOnly` 可绕过 decoder `CoreML -14` 加载错误，但 `zh_short_001` 最终输出为重复符号乱码，且后台 final 耗时过长。
- 已从手机测试 App 沙盒删除 `Documents/Models/Qwen3ASRCoreML/int8`，当前 `Documents` 查询为 `0 files`；测试 App Provider 列表也已移除 `coreml_qwen3_asr`。

## 4. 执行顺序

### Phase A：模型和脚本准备

1. 拉取模型仓库元信息，记录 `int8/` 与 `f32/` 文件结构。
2. 新增 stage 脚本，模型目标目录固定为：

```text
Documents/Models/Qwen3ASRCoreML/int8
Documents/Models/Qwen3ASRCoreML/f32
```

3. stage 脚本必须只操作独立测试 App 沙盒。

### Phase B：独立测试 App 接入

1. Dart Provider Catalog 增加 `coreml_qwen3_asr`。
2. Swift 新增：

```text
CoreMlQwen3AsrDiagnostics.swift
CoreMlQwen3AsrModelStore.swift
CoreMlQwen3AsrTestProvider.swift
```

3. `AppDelegate.swift` 按 `providerId` 路由到 Qwen3 Provider。
4. 未找到模型或 CoreML 加载失败时，只输出诊断事件，不允许闪退。

### Phase C：真机 smoke

先跑三条：

| 样本 | 目的 |
| --- | --- |
| `zh_short_001` | 中文短句、iPhone 14 保护词 |
| `en_short_001` | 英文短句 |
| `mixed_001` | 简单中英混合 |

命令入口：

```bash
cd /Users/xutianliang/Downloads/ai\ phone
IPHONE14_MODEL_PROVIDER=coreml_qwen3_asr \
IPHONE14_MODEL_ID=qwen3_asr_0_6b_coreml_int8 \
npm run iphone14:eval -- status
```

smoke 通过后再进入全量。

### Phase D：P0 全量测试

1. 从 `zh_short_001` 开始。
2. App 点击开始后 Mac 播放音频。
3. App 点击停止后 Mac 拉取 JSONL。
4. 跑完整 ASR P0 27 条，不把 `tts_probe` 纳入 ASR 统计。
5. 结果按 Provider 命名，例如：

```text
zh_short_001-coreml_qwen3_asr-YYYYMMDDTHHMMSSZ.jsonl
```

### Phase E：对比和结论

必须对比：

| 对照项 | 基线 |
| --- | --- |
| Apple Speech | 真机 P0 11/27 |
| CoreML/Nemotron 2240ms | 当前端侧路线，需完整 P0 复跑口径 |
| 服务端 Qwen3 tuned | HTTP P0 26/27 |

输出：

```text
data/model-eval/iphone14-small-models/reports/qwen3-asr-coreml-iphone14-YYYYMMDD.md
data/model-eval/iphone14-small-models/results/qwen3-asr-coreml-int8/summary.json
data/model-eval/iphone14-small-models/results/qwen3-asr-coreml-int8/summary.md
```

## 5. 验收标准

| 指标 | int8 门槛 | f32 门槛 |
| --- | ---: | ---: |
| App 闪退 | 0 | 0 |
| 模型加载失败 | 0 | 0 |
| P0 通过数 | 不低于 CoreML/Nemotron 完整 P0 复跑 | 应高于 int8 |
| 中文短句 | >= 3/4 | >= 3/4 |
| 中文长句 | >= 2/3 | >= 3/3 |
| 中文快语速 | >= 2/3 | >= 2/3 |
| 英文短句 | >= 4/4 | >= 4/4 |
| 英文长句 | >= 3/3 | >= 3/3 |
| 中英混合 | >= 2/4 | >= 3/4 |
| 电话带宽 | >= 1/2 | >= 1/2 |
| 首个 partial | <= 800ms，或优于 Nemotron | <= 800ms |
| final latency | <= 2000ms | <= 2000ms |

## 6. 风险和处理

| 风险 | 处理 |
| --- | --- |
| CoreML 输入/输出结构和现有 FluidAudio Provider 不兼容 | 先做 diagnostics，记录模型接口，再决定是否直接 CoreML 推理或参考上游 runtime |
| `int8` 准确率明显下降 | 不进入产品化，只保留研究；再测 `f32` 判断是否为量化损失 |
| `f32` 包体过大 | 只作精度基线，不进 MVP |
| 长句只有停止后才出字幕 | 调整 Provider buffer/flush，不先改测试集 |
| 中英混合漏短中文 | 记录为模型短板，后续用双路 ASR 或 LLM/术语后处理 |
| 真机过热或内存压力 | 降级为服务端/边缘盒子方案，不进入端侧默认 |

## 7. 完成定义

本测试完成必须同时满足：

1. `int8` 至少完成 smoke 和 P0 全量。
2. 所有 JSONL 原始结果已保存。
3. `summary.json` 和 `summary.md` 已生成。
4. 已与 Apple Speech、CoreML/Nemotron、服务端 Qwen3 tuned 做表格对比。
5. 明确结论为：产品化候选、继续研究、或放弃。
