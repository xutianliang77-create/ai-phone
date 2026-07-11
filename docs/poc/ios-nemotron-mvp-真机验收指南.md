# iOS Nemotron MVP 真机验收指南

本指南用于最后一次真实 iPhone 验收。当前代码、模型和构建产物已经就绪，剩余关键门槛是让 iPhone 进入可安装、可调试、可访问 Mac 服务的状态。

## 1. 先处理 iPhone

在 `Wha的iPhone` 上完成：

1. 打开 Developer Mode。
2. 重启 iPhone 后确认 Developer Mode 仍为开启。
3. 用数据线连接 Mac，解锁 iPhone，并信任此电脑。
4. 保持 iPhone 解锁，或启用同一局域网无线开发。

当前未通过的状态是：

- `developerModeStatus=disabled`
- `tunnelState=unavailable`

这两个值必须变成：

- `developerModeStatus=enabled`
- `tunnelState=connected` 或 `tunnelState=available`

## 2. 刷新本地证据

先在 Mac 上重新构建并检查本地证据：

```bash
npm run ios:nemotron:preflight
```

这一步会检查 iOS 权限元数据、Xcode 真机签名设置、CoreML/FluidAudio runtime、staged Nemotron 模型，重新生成 simulator 和 iPhoneOS no-codesign 构建产物，并确认两个 app bundle 都包含 `multilingual/2240ms` Nemotron 模型资源。

真机已 ready 后，完整一键 run 会默认再执行一次 signed iPhoneOS build。也可以手动提前验证 provisioning profile：

```bash
IOS_NEMOTRON_PREFLIGHT_SIGNED_BUILD=true npm run ios:nemotron:preflight
```

也可以只检查本机是否已有匹配当前 Team、Bundle Identifier、iPhone UDID 的 profile：

```bash
DEVICE_ID="Wha的iPhone" node scripts/check_ios_provisioning_profile.mjs
```

设备 ready 后，可以让命令行调用 Xcode Automatic Signing 注册设备并生成/更新 development profile：

```bash
DEVICE_ID="Wha的iPhone" npm run ios:nemotron:repair-provisioning
```

当前已知 signed build 失败原因为 Apple Team 没有可用于生成 provisioning profile 的设备，且本机当前没有本地 provisioning profile。开启 Developer Mode、解锁接线并信任 Mac 后，Xcode 才能注册设备并为 `com.example.translationMobile` 生成 iOS App Development profile。

## 3. 复查状态

```bash
DEVICE_ID="Wha的iPhone" npm run ios:nemotron:status
```

这条命令会同时刷新 `.cache/ios-nemotron-services/mvp-status.json`，供验收报告和机器可读摘要复用。

本地应保持 PASS：

- `ios_runtime_permissions`
- `ios_signing_settings`
- `ios_provisioning_profile`
- `ios_coreml_runtime`
- `staged_nemotron_model`
- `ios_simulator_build`
- `built_simulator_app_nemotron_resource`
- `ios_device_build`
- `built_device_app_nemotron_resource`
- `lmstudio_translation_provider`

真机准备好后，`physical_iphone_readiness` 应变成 PASS。
随后完整 run 会要求 `ios_signed_device_build` 也变成 PASS。

上机前也可以单独验证 Mac 局域网 IP 和默认 LM Studio 翻译 Provider：

```bash
npm run ios:nemotron:detect-lan-ip -- --json
npm run ios:nemotron:check-lmstudio -- --json
```

`check-lmstudio` 会刷新 `.cache/ios-nemotron-services/lmstudio-provider.json`，
最终验收报告会读取这份证据。

如果正在手机上开启 Developer Mode，可以让 Mac 等待设备变 ready：

```bash
DEVICE_ID="Wha的iPhone" npm run ios:nemotron:wait-device
```

等待脚本会同时刷新：

```text
.cache/ios-nemotron-services/device-readiness-wait.log
.cache/ios-nemotron-services/device-readiness-latest.json
.cache/ios-nemotron-services/provisioning-profile-latest.json
docs/poc/ios-nemotron-mvp-acceptance-report.md
.cache/ios-nemotron-services/mvp-acceptance-summary.json
```

其中 readiness JSON 会记录 `pairingState`、`developerModeStatus`、`tunnelState` 和建议修复动作，方便在手机侧操作后确认状态有没有变化。设备 ready 后，provisioning profile JSON 会记录本机 profile 数量、匹配结果和下一步动作。

如果等待命令超时或自行退出，会自动刷新 Markdown 验收报告和 JSON 摘要；如果设备 ready 后交接到 `--run`，最终报告由完整 run 的退出清理阶段刷新。

推荐让设备 ready 后直接接上完整 MVP：

```bash
DEVICE_ID="Wha的iPhone" npm run ios:nemotron:wait-device -- --run
```

如只想修复 provisioning profile，不进入最终 smoke，可使用：

```bash
DEVICE_ID="Wha的iPhone" npm run ios:nemotron:wait-device -- --repair
```

## 4. 一键跑完整 MVP

```bash
DEVICE_ID="Wha的iPhone" npm run ios:nemotron:run
```

脚本会自动：

1. 检查真实 iPhone readiness。
2. 调用 Xcode Automatic Signing 尝试注册设备并生成/更新 provisioning profile。
3. 跑本地 preflight，刷新构建、模型资源和 signed build 证据。
4. 启动 API 和 Realtime Gateway。
5. 校验 API/Gateway health。
6. 校验 LM Studio 翻译 Provider。
7. 跑 CoreML/Nemotron diagnostics。
8. 跑麦克风 ASR selftest。
9. 跑 native ASR -> Gateway -> 翻译 -> API 历史 e2e。
10. 退出时停止本地服务。
11. 退出时用本次 run 已生成的 status 缓存自动刷新 Markdown 报告和 JSON 摘要。

默认 smoke 会把 diagnostics、selftest、e2e 合并到一次 Flutter integration-test 安装中运行，避免 600MB+ Nemotron 模型资源在同一次验收里反复安装。只有设置自定义 `IOS_MVP_SMOKE_STEPS` 时才按单步骤逐个运行。

为避免真机 diagnostics、麦克风自测或 e2e 卡住后一直等待，底层 smoke 脚本有硬超时：

- `IOS_SMOKE_DIAGNOSTICS_TIMEOUT_SECONDS`：默认 240 秒。
- `IOS_SMOKE_SELFTEST_TIMEOUT_SECONDS`：默认 `DEVICE_ASR_SELF_TEST_SECONDS + 240` 秒。
- `IOS_SMOKE_E2E_TIMEOUT_SECONDS`：默认 `DEVICE_ASR_E2E_SECONDS + 300` 秒。

如果现场模型首次加载或下载较慢，可以临时调大对应超时；如果触发超时，先看 `.cache/ios-nemotron-services/mvp-smoke.log`。

## 5. 人工配合

运行过程中需要对着 iPhone 说一句短句，例如：

- 英文：`Hello, this is a realtime translation test.`
- 中文：`你好，这是一次实时翻译测试。`

如果弹出权限，请允许：

- 本地网络权限
- 麦克风权限

## 6. 生成验收报告

跑完后生成报告：

```bash
DEVICE_ID="Wha的iPhone" npm run ios:nemotron:report
```

默认会重新跑一次 live status，并刷新 `.cache/ios-nemotron-services/mvp-status.json`，避免报告误用旧 dry-run 状态。只有需要复查历史状态缓存时才使用：

```bash
DEVICE_ID="Wha的iPhone" npm run ios:nemotron:report -- --cached-status
```

注意：`ios:nemotron:run` 退出时自动生成的报告会使用本次 run 内已捕获的 status 缓存，因为服务会在 cleanup 中停止。

最终闸门可以使用严格模式；如果报告不是 `Overall: PASS`，命令会返回非 0：

```bash
DEVICE_ID="Wha的iPhone" npm run ios:nemotron:report -- --strict
```

报告路径：

```text
docs/poc/ios-nemotron-mvp-acceptance-report.md
```

机器可读摘要路径：

```text
.cache/ios-nemotron-services/mvp-acceptance-summary.json
```

最终通过时，报告应显示：

- `Overall: PASS`
- `physical_iphone_readiness` PASS
- `api_gateway_services` PASS
- `LM Studio provider status` PASS

并且 smoke 日志中应出现：

- `COREML_NEMOTRON_PREPARE_OK`
- `COREML_NEMOTRON_SELF_TEST_SEGMENT`
- `translationFinal=true`
- `historySaved=true`
- `historyStatus=ended`

## 7. 当前结论

当前不能标记 MVP 完成，因为真实 iPhone 仍未通过 readiness gate。只要 Developer Mode 和 tunnel 变为 ready，就可以直接运行一键验收命令。
