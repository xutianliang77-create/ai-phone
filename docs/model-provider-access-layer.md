# 模型接入层设计

版本：v0.1  
日期：2026-07-05

## 目标

ASR、翻译、TTS 都必须通过统一接入层切换模型，业务代码不直接绑定某个模型：

- App/Gateway/Worker 只依赖稳定 Provider 接口。
- 模型服务只暴露稳定 HTTP 协议。
- `release/domestic/model-routing.json` 是模型切换入口。

## 三层结构

```text
App / API / Gateway / Worker
        |
Provider adapters
        |
Model services / external providers
        |
ASR model / translation model / TTS model
```

当前 Provider：

| 能力 | Runtime 接口 | 当前主路由 | 可切换候选 |
| --- | --- | --- | --- |
| ASR | `ASR_PROVIDER=http` + `/asr/transcribe` | `Qwen3-ASR-0.6B original tuned v3` | FireRedASR2-AED、SenseVoice |
| 翻译 | OpenAI-compatible `/v1/chat/completions` | `tencent/Hy-MT2-1.8B` | Qwen、LMT、MADLAD400 |
| TTS | `/tts/synthesize` 返回 PCM16 | VoxCPM2 | Chatterbox、Qwen3-TTS、系统 TTS |
| LLM 优化整理 | OpenAI-compatible `/v1/chat/completions` | qwen-plus / Qwen-compatible | Qwen3、DeepSeek、GLM、LM Studio 本地 Qwen |

LLM 优化整理的功能边界见 `docs/llm-asr-refinement-and-record-review-functional-design.md`；实时 ASR 优化细节见 `docs/llm-asr-refinement-functional-design.md`；会议纪要和通信记录整理细节见 `docs/llm-record-review-functional-design.md`。
LLM 接入层技术方案见 `docs/llm-provider-access-layer-design.md`。

## 路由档案

主文件：

```text
release/domestic/model-routing.json
```

核心字段：

- `activeProfile`：当前启用的模型组合。
- `profiles.*.asr`：ASR Provider、模型和协议。
- `profiles.*.translation`：翻译 Provider、模型和协议。
- `profiles.*.tts`：TTS Provider、模型和协议。
- `profiles.*.llm`：ASR 文本优化、会议纪要和通信记录整理 Provider。
- `profiles.*.env`：渲染给 Gateway、Worker、模型服务的环境变量。

检查：

```bash
npm run check:model-routing -- --json
```

切换模型：

```bash
npm run render:model-routing-env -- --profile domestic_server_qwen3_hymt2_voxcpm2
```

也可以只渲染某个运行分组，避免 Gateway、Worker、模型服务之间的变量互相覆盖：

```bash
npm run render:model-routing-env -- --profile domestic_server_qwen3_hymt2_voxcpm2 --group gateway
npm run render:model-routing-env -- --profile domestic_server_qwen3_hymt2_voxcpm2 --group translationWorker
```

本地国内版 API/Gateway 启动检查可以直接指定 profile：

```bash
npm run check:domestic-local-stack -- \
  --model-routing-profile domestic_server_qwen3_hymt2_voxcpm2 \
  --json
```

iPhone/Gateway 联调脚本也支持相同入口；未设置 profile 时仍使用原有默认值：

```bash
MODEL_ROUTING_PROFILE=domestic_server_qwen3_hymt2_voxcpm2 \
IOS_NEMOTRON_CHECK_LMSTUDIO=false \
scripts/ios_nemotron_start_services.sh
```

Call Link Translation Worker 也支持同一 profile。Worker 与模型服务同机运行时，
profile 里的 `127.0.0.1` endpoint 会直接指向本机模型服务：

```bash
MODEL_ROUTING_PROFILE=domestic_server_qwen3_hymt2_voxcpm2 \
TRANSLATION_WORKER_CALL_ID=<callId> \
API_BASE_URL=http://<api-host>:3000 \
INTERNAL_API_SECRET=<internal-secret> \
npm run dev:call-link-worker
```

## 新增模型步骤

1. 在对应模型服务里新增 Loader 或接外部 HTTP Provider。
2. 在 `model-routing.json` 新增 profile 或修改候选 profile。
3. 运行 `npm run check:model-routing -- --json`。
4. 运行对应 smoke：ASR、`check:translation-provider`、`check:tts-provider`、LLM JSON 输出检查。
5. 通过模型评测后，再更新 `release/domestic/model-selection-report.json`。

## 当前边界

Hy-MT2 翻译服务骨架已补齐在：

```text
services/model-services/translation-service
```

它对外提供 OpenAI-compatible `/v1/chat/completions`，因此 Gateway 和
Translation Worker 不需要改协议即可切换。ASR 服务已补 `Qwen3-ASR-0.6B original tuned v3`
和 `FireRedASR2-AED` engine，并通过 `domestic_server_qwen3_hymt2_voxcpm2` profile
作为服务端主路由；FireRedASR2-AED 和 SenseVoice 保留为服务端 ASR 兜底 profile。
