# iPhone14 Model Tester

独立模型测试 App，用于 iPhone 真机 ASR/TTS/模型横评。这个 App 是实验软件，不依赖也不修改主 App。

## 当前能力

- Apple Speech ASR 基线测试。
- iOS 系统 TTS 基线测试。
- P0/P1 测试集选择。
- Mac 控制脚本按钮联动：App 点开始后 Mac 播放音频，App 点停止后 Mac 拉取 JSONL 并计算 CER/WER。
- Provider 选择与统一结果字段：`providerId`、`providerName`、`providerKind`、`modelId`、`mode`。
- CoreML/Nemotron Provider：已接入测试 App 自己的 FluidAudio runtime 和 CoreML/Nemotron bridge；模型未放入时会把缺失原因写入 JSONL。

## Provider

| Provider | 状态 | 用途 |
| --- | --- | --- |
| `apple_speech` | 可测 | iOS `SFSpeechRecognizer` ASR 基线 |
| `coreml_nemotron` | 待模型包 | 测试 App 内真实 FluidAudio/CoreML ASR，需先 stage 模型 |
| `remote_asr` | 待接入 | 后续对接 Beelink/服务器 ASR |

`coreml_qwen3_asr` 已从测试队列剔除：iPhone 14 真机上 `int8` 变体可录音并可进入 decoder，但输出重复符号乱码且延迟过高；手机沙盒模型已删除，不再 stage 或选择该 Provider。

## Mac 控制脚本

```bash
cd /Users/xutianliang/Downloads/ai\ phone
npm run iphone14:eval -- status
npm run iphone14:eval -- set zh_short_001
npm run iphone14:eval -- usb-watch
```

指定 Provider：

```bash
IPHONE14_MODEL_PROVIDER=apple_speech npm run iphone14:eval -- status
IPHONE14_MODEL_PROVIDER=coreml_nemotron npm run iphone14:eval -- status
```

CoreML/Nemotron 目前只检查测试 App 自己的模型目录，不读取主 App 沙盒。诊断扫描路径包括：

```text
Runner.app/Models/NemotronASRStreaming
Runner.app/Models/multilingual/2240ms
Documents/Models/NemotronASRStreaming
Documents/Models/multilingual/2240ms
```

当前阶段若未放入模型包，App 会保存 `provider.diagnostic` 和 `error` 事件，原因通常是 `model_not_staged_in_test_app`。模型目录准备好后，可把现有 2240ms 模型推到测试 App 沙盒：

```bash
cd /Users/xutianliang/Downloads/ai\ phone
npm run iphone14:stage:nemotron -- --dry-run
npm run iphone14:stage:nemotron
```

如果使用其他模型目录：

```bash
IPHONE14_NEMOTRON_MODEL_DIR=/path/to/2240ms npm run iphone14:stage:nemotron
```

结果文件会按 Provider 命名，例如：

```text
data/model-eval/iphone14-small-models/results/device-pulls/single/zh_short_001-apple_speech-YYYYMMDDTHHMMSSZ.jsonl
```

## 真机启动

```bash
cd /Users/xutianliang/Downloads/ai\ phone/test-apps/iphone14_model_tester
flutter --no-version-check run --profile -d 00008120-00083592346BC01E \
  --dart-define=EVAL_CONTROL_URL=http://192.168.1.142:3188 \
  --no-resident
```

## 边界

- 不修改主 App。
- 不用主 App 做实验编译安装。
- 新模型先接入本测试 App 或单独 target，再决定是否产品化合入主 App。
