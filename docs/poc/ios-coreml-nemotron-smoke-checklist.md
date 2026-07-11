# iOS CoreML Nemotron Smoke Checklist

Use this checklist for the physical iPhone validation path after the app has a
FluidAudio-ready Nemotron CoreML bundle staged or runtime download is enabled.
Chinese operator guide: `docs/poc/ios-nemotron-mvp-真机验收指南.md`.

## Device Readiness

1. Use an iOS 17+ iPhone.
2. Enable Developer Mode on the iPhone.
3. Keep the phone unlocked and connected by cable, or enable same-LAN wireless
   development.
4. Confirm readiness before running Flutter:

```bash
DEVICE_ID="Wha的iPhone" \
scripts/diagnose_ios_device.mjs --require-ready
```

Ready means `pairingState=paired`, `developerModeStatus=enabled`, and
`tunnelState=connected` or `tunnelState=available`. If this command exits with
rc=2, fix the printed device action first.

When the phone is being unlocked or Developer Mode is being enabled, use the
waiter to keep checking and write the latest structured device snapshot:

```bash
DEVICE_ID="Wha的iPhone" npm run ios:nemotron:wait-device
```

Latest snapshots:

- `.cache/ios-nemotron-services/device-readiness-latest.json`
- `.cache/ios-nemotron-services/provisioning-profile-latest.json` after the device is ready
- `docs/poc/ios-nemotron-mvp-acceptance-report.md` is refreshed when waiting exits
- `.cache/ios-nemotron-services/mvp-acceptance-summary.json` is refreshed when waiting exits

Recommended: wait for the iPhone and then run the full MVP flow:

```bash
DEVICE_ID="Wha的iPhone" npm run ios:nemotron:wait-device -- --run
```

To wait and run provisioning repair only, without final smoke:

```bash
DEVICE_ID="Wha的iPhone" npm run ios:nemotron:wait-device -- --repair
```

## Service Setup

1. Start API and Realtime Gateway on the Mac:

```bash
npm run ios:nemotron:services
```

2. Keep that terminal open. The script prints the iPhone-facing
   `API_BASE_URL` and `REALTIME_BASE_URL`.
3. Use the Mac LAN IP, not `127.0.0.1`, for iPhone-facing URLs.
4. Confirm API `/health` returns
   `realtimeWsEndpoint=ws://YOUR_MAC_LAN_IP:3201/realtime`.
5. Confirm Gateway `/health` reports `sessionEventSink=api`.

To inspect the auto-detected Mac LAN IP:

```bash
npm run ios:nemotron:detect-lan-ip -- --json
```

If the Mac has multiple active interfaces, set `MAC_LAN_INTERFACE=en0` or
`MAC_LAN_IP=YOUR_MAC_LAN_IP` before running the service or MVP scripts.

To verify the default LM Studio translation Provider before using the iPhone:

```bash
npm run ios:nemotron:check-lmstudio -- --json
```

The service script runs this check automatically when
`REALTIME_PROVIDER=lmstudio`; set `IOS_NEMOTRON_CHECK_LMSTUDIO=false` only for
offline wiring tests.

## One-Command MVP Smoke

Before using the physical iPhone, refresh all local build evidence:

```bash
npm run ios:nemotron:preflight
```

This checks iOS permission metadata, resolved iPhone signing settings,
CoreML/FluidAudio runtime settings, and the staged Nemotron model, then rebuilds
the simulator and iPhoneOS no-codesign apps and checks that both bundles contain
the staged FluidAudio-ready Nemotron model.

After the physical iPhone is ready, the full `ios:nemotron:run` flow requires a
signed iPhoneOS build before smoke starts. To test that manually:

```bash
IOS_NEMOTRON_PREFLIGHT_SIGNED_BUILD=true npm run ios:nemotron:preflight
```

If Xcode reports that no provisioning profile exists for
`com.example.translationMobile`, connect and unlock the iPhone, trust the Mac,
and let Xcode register that device for the Apple Team.

To check only the local provisioning profile evidence:

```bash
DEVICE_ID="Wha的iPhone" node scripts/check_ios_provisioning_profile.mjs
```

After the iPhone is ready, ask xcodebuild Automatic Signing to register the
device and create/update the development profile:

```bash
DEVICE_ID="Wha的iPhone" npm run ios:nemotron:repair-provisioning
```

For the full physical iPhone flow, use the orchestrated command:

```bash
DEVICE_ID="Wha的iPhone" npm run ios:nemotron:run
```

It checks iPhone readiness, asks Xcode Automatic Signing to repair provisioning,
runs the local preflight, starts API/Gateway, runs the status gate, runs the
full MVP smoke, refreshes the acceptance report, and stops local services on
exit.

The default full smoke runs diagnostics, selftest, and e2e in one Flutter
integration-test install through `IOS_SMOKE_MODE=mvp`. This avoids installing
the large staged Nemotron model bundle three times during one acceptance run.
Custom `IOS_MVP_SMOKE_STEPS` values still run step by step.

Generate or refresh the evidence report after each attempt:

```bash
DEVICE_ID="Wha的iPhone" npm run ios:nemotron:report
```

Before launching the app manually, summarize all current gates:

```bash
DEVICE_ID="Wha的iPhone" \
API_BASE_URL=http://YOUR_MAC_LAN_IP:3100 \
REALTIME_BASE_URL=http://YOUR_MAC_LAN_IP:3201 \
scripts/ios_nemotron_mvp_status.mjs
```

The status command also checks local provisioning profile availability for the
selected iPhone.

Expected local gates before the physical iPhone is fixed:

- `ios_runtime_permissions` is `PASS`
- `ios_signing_settings` is `PASS`
- `ios_provisioning_profile` is `PASS` after Xcode creates a local profile
  matching the Team, Bundle Identifier, and iPhone UDID
- `ios_coreml_runtime` is `PASS`
- `staged_nemotron_model` is `PASS`
- `ios_simulator_build` is `PASS`
- `built_simulator_app_nemotron_resource` is `PASS`
- `ios_device_build` is `PASS`; refresh it with
  `flutter --no-version-check build ios --debug --no-codesign --no-pub`
- `built_device_app_nemotron_resource` is `PASS`
- `physical_iphone_readiness` is `PASS` only after Developer Mode and tunnel are ready
- `ios_signed_device_build` is `PASS` after a signed iPhoneOS build succeeds
- `lmstudio_translation_provider` is `PASS` after the LM Studio smoke returns a non-empty translation
- `api_gateway_services` is `PASS` only after API/Gateway env vars point to running services

After the device and services are ready, run the full MVP smoke:

```bash
DEVICE_ID="Wha的iPhone" \
API_BASE_URL=http://YOUR_MAC_LAN_IP:3100 \
REALTIME_BASE_URL=http://YOUR_MAC_LAN_IP:3201 \
scripts/ios_nemotron_mvp_smoke.sh
```

The script first checks the iOS microphone/local-network permission metadata and
localized prompt strings. It then runs diagnostics with prepare, microphone
selftest, and Gateway e2e. If `e2e` is included, the script prechecks
API `/health`, the expected `realtimeWsEndpoint`, Gateway `/health`, and
`sessionEventSink=api` before asking you to speak into the phone. Use
`IOS_MVP_SMOKE_STEPS=diagnostics,selftest` to stop before Gateway e2e.

The Flutter integration-test steps have hard timeouts so a stuck model load or
test runner cannot block the full MVP run forever:

- `IOS_SMOKE_DIAGNOSTICS_TIMEOUT_SECONDS`, default `240`
- `IOS_SMOKE_SELFTEST_TIMEOUT_SECONDS`, default `DEVICE_ASR_SELF_TEST_SECONDS + 240`
- `IOS_SMOKE_E2E_TIMEOUT_SECONDS`, default `DEVICE_ASR_E2E_SECONDS + 300`

If a timeout occurs, inspect `.cache/ios-nemotron-services/mvp-smoke.log`.

## Native Diagnostics

Verify model resolution and `loadModels` before opening the microphone:

```bash
DEVICE_ID="Wha的iPhone" \
IOS_SMOKE_MODE=diagnostics \
DEVICE_ASR_AUTO_DOWNLOAD_MODEL=false \
DEVICE_ASR_PREPARE_MODEL=true \
scripts/ios_nemotron_device_smoke.sh
```

Expected markers:

- `COREML_NEMOTRON_AVAILABILITY`
- `COREML_NEMOTRON_MODEL_SCAN`
- `COREML_NEMOTRON_PREPARE_OK`
- `preparedModelReady=true`
- `fluidAudio.prepared=true`
- `COREML_NEMOTRON_DISPOSE_OK`

## Microphone Selftest

Verify real iPhone microphone capture and native ASR events:

```bash
DEVICE_ID="Wha的iPhone" \
IOS_SMOKE_MODE=selftest \
DEVICE_ASR_AUTO_DOWNLOAD_MODEL=false \
DEVICE_ASR_SELF_TEST_SECONDS=20 \
scripts/ios_nemotron_device_smoke.sh
```

Speak a short Chinese or English sentence while the test is running.

Expected markers:

- `COREML_NEMOTRON_SELF_TEST_STARTED`
- `COREML_NEMOTRON_SELF_TEST_SEGMENT`
- `COREML_NEMOTRON_SELF_TEST_RESULT`
- `COREML_NEMOTRON_SELF_TEST_AVAILABILITY_AFTER_STOP`

Selftest logs segment character counts by default. Set
`DEVICE_ASR_LOG_TEXT=true` only when recognized text may be printed in logs.

## Gateway E2E

Verify native ASR -> Gateway -> translation -> API history:

```bash
DEVICE_ID="Wha的iPhone" \
IOS_SMOKE_MODE=e2e \
API_BASE_URL=http://YOUR_MAC_LAN_IP:3100 \
REALTIME_BASE_URL=http://YOUR_MAC_LAN_IP:3201 \
DEVICE_ASR_AUTO_DOWNLOAD_MODEL=false \
DEVICE_ASR_E2E_SECONDS=45 \
scripts/ios_nemotron_device_smoke.sh
```

Expected result fields:

- `apiHealthOk=true`
- `translationFinal=true`
- `serverOwnedHistory=true`
- `historySaved=true`
- `historyStatus=ended`

Gateway logs must include `Client text segment received` with `sessionId`,
`segmentId`, `language`, `isFinal`, `charCount`, and `confidence`. The log must
not include transcript text.

## App Manual Smoke

1. Launch the app with `USE_DEVICE_ASR=true`.
2. Open `端侧 ASR 诊断`.
3. Tap `检查服务`; reject any `127.0.0.1` endpoint on a real iPhone.
4. Tap Start and allow local network and microphone permissions.
5. Speak a short English sentence, pause, then speak a short Chinese sentence.
6. Tap End.
7. Confirm History contains the ended session with source and translated text.

## Simulator Recovery

Simulator diagnostics can prove the iOS MethodChannel and model packaging path,
but they do not prove real microphone capture, real-device performance, or
Neural Engine behavior.

If a repeated simulator run hangs at `simctl install`, stop the hanging command,
confirm no Flutter/simctl process remains, then reboot the simulator:

```bash
ps -axo pid,ppid,etime,command | \
  rg 'Runner --enable|flutter test integration_test|simctl install'
xcrun simctl shutdown DEVICE_UDID
xcrun simctl boot DEVICE_UDID
xcrun simctl bootstatus DEVICE_UDID -b
```

Re-run diagnostics only after the previous `Runner.app/Runner` process is gone.

## Remaining Work

1. Run diagnostics, selftest, and e2e on a physical iPhone.
2. Tune endpoint thresholds on real speech, noisy rooms, and short bilingual
   phrases.
3. Decide whether App Store builds bundle the model or download it after login.
4. Add Android LiteRT/ONNX/system-ASR provider behind `MobileAsrProvider`.

## Model Sources Checked

- `playstonex/Nemotron-3.5-ASR-Streaming-0.6B-CoreML-INT8` ships
  `encoder.mlmodelc`, `decoder.mlmodelc`, `joint.mlmodelc`, `vocab.json`,
  `languages.json`, and `config.json`.
- `FluidInference/Nemotron-3.5-ASR-Streaming-Multilingual-0.6b-CoreML` ships
  tiered folders such as `multilingual/2240ms` with `preprocessor`, `encoder`,
  `decoder`, `joint`, `decoder_joint`, `metadata.json`, and `tokenizer.json`.
- The model cards recommend 16 kHz mono input. The FluidInference card
  recommends the 2 s tier for Chinese / Japanese / multilingual use.
