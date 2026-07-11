# iOS Nemotron MVP Acceptance Report

Generated at: 2026-07-02T15:39:52.143Z

## Summary

- Overall: NOT READY
- Device: 徐天亮的iPhone
- Simulator app: /Users/xutianliang/Downloads/翻译软件app/apps/mobile/build/ios/iphonesimulator/Runner.app
- iPhoneOS app: /Users/xutianliang/Downloads/翻译软件app/apps/mobile/build/ios/iphoneos/Runner.app
- Status source: /Users/xutianliang/Downloads/翻译软件app/.cache/ios-nemotron-services/mvp-status.json
- Status generated at: 2026-07-02T15:39:52.131Z
- Status freshness: fresh (age 0h / max 2h)
- JSON summary: /Users/xutianliang/Downloads/翻译软件app/.cache/ios-nemotron-services/mvp-acceptance-summary.json
- Preflight source: /Users/xutianliang/Downloads/翻译软件app/.cache/ios-nemotron-services/preflight.json
- Preflight status: NOT READY
- Provisioning repair source: /Users/xutianliang/Downloads/翻译软件app/.cache/ios-nemotron-services/provisioning-repair.json
- Provisioning repair status: NOT READY
- Signed build source: /Users/xutianliang/Downloads/翻译软件app/.cache/ios-nemotron-services/signed-build.json
- Signed build status: NOT READY
- LM Studio provider source: /Users/xutianliang/Downloads/翻译软件app/.cache/ios-nemotron-services/lmstudio-provider.json
- LM Studio provider required: no
- LM Studio provider status: PASS
- Wait-device readiness source: /Users/xutianliang/Downloads/翻译软件app/.cache/ios-nemotron-services/device-readiness-latest.json
- Wait-device log source: /Users/xutianliang/Downloads/翻译软件app/.cache/ios-nemotron-services/device-readiness-wait.log
- Completion claim: Not complete. Gates or final smoke evidence are still missing.

## Gates

| Gate | Status | Evidence |
| --- | --- | --- |
| ios_runtime_permissions | PASS | iOS runtime permission metadata is ready. |
| ios_signing_settings | PASS | iOS signing settings are ready; team=5YR3BKMQ62; bundle=com.example.translationMobile; identity=iPhone Developer |
| ios_provisioning_profile | PENDING | waiting for physical_iphone_readiness before provisioning profile repair is required |
| ios_coreml_runtime | PASS | iOS CoreML/Nemotron runtime settings are ready. |
| mobile_chinese_interface | PASS | Mobile interface defaults to Chinese and iOS/Android Chinese resources are ready. |
| ios_native_asr_bridge | PASS | Flutter provider and iOS Swift ASR bridge contract are ready. |
| ios_on_device_translation | PASS | Flutter provider and iOS Apple Translation bridge contract are ready. |
| ios_mvp_smoke_contract | PASS | Final iPhone smoke covers diagnostics, ASR, translation, history, and report markers. |
| ios_signing_flow_contract | PASS | Provisioning repair, signed build evidence, and report wiring are ready. |
| ios_service_startup_contract | PASS | API/Gateway startup defaults to LAN, LM Studio, device ASR text, and server-owned history. |
| staged_nemotron_model | PASS | ready fluid_split_fused /Users/xutianliang/Downloads/翻译软件app/apps/mobile/ios/Runner/Models/multilingual/2240ms |
| ios_simulator_build | PASS | built app exists: /Users/xutianliang/Downloads/翻译软件app/apps/mobile/build/ios/iphonesimulator/Runner.app |
| built_simulator_app_nemotron_resource | PASS | ready fluid_split_fused /Users/xutianliang/Downloads/翻译软件app/apps/mobile/build/ios/iphonesimulator/Runner.app/Models/multilingual/2240ms; app=825.4MiB; models=634.1MiB; selected=634MiB |
| ios_device_build | PASS | built app exists: /Users/xutianliang/Downloads/翻译软件app/apps/mobile/build/ios/iphoneos/Runner.app |
| built_device_app_nemotron_resource | PASS | ready fluid_split_fused /Users/xutianliang/Downloads/翻译软件app/apps/mobile/build/ios/iphoneos/Runner.app/Models/multilingual/2240ms; app=657.4MiB; models=634.1MiB; selected=634MiB |
| physical_iphone_readiness | FAIL | iOS device diagnostic from devicectl \| 徐天亮的iPhone (iPhone 14 Pro, iOS 26.5) \| pairingState=paired \| developerModeStatus=enabled \| tunnelState=disconnected \| action: keep the iPhone unlocked and connected by cable, or enable same-LAN wireless development. \| not ready for real-device Nemotron smoke |
| ios_signed_device_build | PENDING | waiting for physical_iphone_readiness before signed iPhoneOS build is required |
| lmstudio_translation_provider | PASS | not required for local on-device MVP |
| api_gateway_services | PASS | not required for local on-device MVP |


## Physical iPhone Readiness

- Ready: no
- Requested device: 徐天亮的iPhone
- Physical devices: 2
- Matched devices: 1

| Device | Model | iOS | Pairing | Developer Mode | Tunnel | Last Connection | Ready |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 徐天亮的iPhone | iPhone 14 Pro | 26.5 | paired | enabled | disconnected | 2026-07-02T04:19:00.000Z | no |

- 徐天亮的iPhone: keep the iPhone unlocked and connected by cable, or enable same-LAN wireless development.



## Wait Device Evidence

- Ready: no
- Requested device: 徐天亮的iPhone
- Physical devices: 2
- Matched devices: 1
- Readiness JSON exists: yes
- Readiness JSON freshness: fresh (modified 2026-07-02T15:39:35.327Z, age 0h / max 2h)
- Wait log exists: yes
- Wait log freshness: fresh (modified 2026-07-02T15:39:37.572Z, age 0h / max 2h)
- Wait log attempted: yes
- Report refreshed on exit: yes
- Issues: none

- Actions: 
  - 徐天亮的iPhone: keep the iPhone unlocked and connected by cable, or enable same-LAN wireless development.

| Device | Model | iOS | Pairing | Developer Mode | Tunnel | Ready |
| --- | --- | --- | --- | --- | --- | --- |
| 徐天亮的iPhone | iPhone 14 Pro | 26.5 | paired | enabled | disconnected | no |


## Local Preflight

- Exists: yes
- Status: pass
- Generated at: 2026-06-27T16:54:59.645Z
- Freshness: stale (age 118.75h / max 24h)
- Simulator app: /Users/xutianliang/Downloads/翻译软件app/apps/mobile/build/ios/iphonesimulator/Runner.app
- iPhoneOS app: /Users/xutianliang/Downloads/翻译软件app/apps/mobile/build/ios/iphoneos/Runner.app
- Signed build requested: no
- Signed build JSON: /Users/xutianliang/Downloads/翻译软件app/.cache/ios-nemotron-services/signed-build.json

## Provisioning Repair

- Exists: yes
- Status: waiting_on_physical_iphone
- Stage: device_readiness
- Generated at: 2026-06-27T16:01:00.495Z
- Freshness: not_pass (age 119.65h / max 24h)
- Log: /Users/xutianliang/Downloads/翻译软件app/.cache/ios-nemotron-services/provisioning-repair.log
- Profile before: status=not_ready; profileCount=0; candidateCount=0
- Profile after: missing
- Issues: 
  - waiting for physical_iphone_readiness before provisioning profile repair is required
- Actions: 
  - 徐天亮的iPhone: keep the iPhone unlocked and connected by cable, or enable same-LAN wireless development.

## Signed Device Build

- Exists: yes
- Status: waiting_on_physical_iphone
- Generated at: 2026-06-27T15:31:17.852Z
- Freshness: not_pass (age 120.14h / max 24h)
- Command: flutter --no-version-check build ios --debug --no-pub
- Log: /Users/xutianliang/Downloads/翻译软件app/.cache/ios-nemotron-services/signed-device-build.log
- Issues: 
  - waiting for physical_iphone_readiness before signed iPhoneOS build is required
- Actions: 
  - 徐天亮的iPhone: keep the iPhone unlocked and connected by cable, or enable same-LAN wireless development.

## LM Studio Translation Provider

- Exists: yes
- Required: no
- Status: fail
- Freshness: stale (modified 2026-07-01T18:06:02.041Z, age 21.56h / max 2h)
- Base URL: http://222.128.62.139:1234/v1
- Model: qwen/qwen3.5-9b
- Model listed: no
- Latency: 1074ms
- Reasoning tokens: unknown
- Translation non-empty: no (0 chars)
- Issues: none

- Actions: none


## Required Final Smoke

Run this only after all gates pass:

```bash
DEVICE_ID="Wha的iPhone" npm run ios:nemotron:run
```

Expected final evidence:

- diagnostics emits `COREML_NEMOTRON_PREPARE_OK`
- microphone selftest emits `COREML_NEMOTRON_SELF_TEST_SEGMENT`
- structured results prove `deviceAsrProvider=coreml_nemotron`, `sourceLanguage=auto`, `targetLanguage=zh`, `modelChunkMs=2240`, and `autoDownloadModel=false`
- local MVP emits `COREML_NEMOTRON_LOCAL_MVP_RESULT` with `translationAvailable=true` and `translationFinal=true`
- local history emits `COREML_NEMOTRON_LOCAL_MVP_HISTORY` with saved segments
- local Markdown export reports `localExportReady=true`

## Final Smoke Evidence

- Smoke log: /Users/xutianliang/Downloads/翻译软件app/.cache/ios-nemotron-services/mvp-smoke.log
- Smoke log exists: yes
- Smoke log freshness: stale (modified 2026-06-27T16:30:32.531Z, age 119.16h / max 2h)
- Smoke log issues: 
  - required smoke marker is missing: COREML_NEMOTRON_PREPARE_OK
  - required smoke marker is missing: COREML_NEMOTRON_SELF_TEST_SEGMENT
  - required smoke marker is missing: COREML_NEMOTRON_LOCAL_MVP_RESULT
  - required smoke marker is missing: COREML_NEMOTRON_LOCAL_MVP_HISTORY
  - structured smoke result is missing: COREML_NEMOTRON_SELF_TEST_RESULT
  - structured smoke result is missing: COREML_NEMOTRON_LOCAL_MVP_RESULT
- Gateway log: /Users/xutianliang/Downloads/翻译软件app/.cache/ios-nemotron-services/realtime-gateway.log
- Gateway log exists: yes
- Gateway log freshness: stale (modified 2026-06-27T17:48:24.356Z, age 117.86h / max 2h)
- Gateway log issues: none


| Evidence | Marker | Status |
| --- | --- | --- |
| diagnostics prepare | COREML_NEMOTRON_PREPARE_OK | MISSING |
| microphone ASR segment | COREML_NEMOTRON_SELF_TEST_SEGMENT | MISSING |
| local MVP structured result | COREML_NEMOTRON_LOCAL_MVP_RESULT | MISSING |
| local MVP history saved | COREML_NEMOTRON_LOCAL_MVP_HISTORY | MISSING |
| Gateway services | not required for local on-device MVP | FOUND |

## Structured Smoke Results

| Result | Marker | Status | Summary |
| --- | --- | --- | --- |
| Microphone self-test result | COREML_NEMOTRON_SELF_TEST_RESULT | MISSING | missing |
| Local on-device MVP result | COREML_NEMOTRON_LOCAL_MVP_RESULT | MISSING | missing |

## Next Actions

- On the iPhone, enable Developer Mode, keep it unlocked, connect by cable, and trust this Mac.
- Then run `DEVICE_ID="徐天亮的iPhone" npm run ios:nemotron:wait-device -- --run` to wait for readiness, repair provisioning, and run the full MVP smoke.
