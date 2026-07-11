# iOS Core ML Nemotron ASR Runbook

This runbook tracks the iOS device-ASR MVP path:

```text
iOS Core ML Nemotron ASR
-> Flutter MobileAsrProvider
-> client.text.segment
-> Realtime Gateway
-> Translation Provider
-> API session history
```

## Current State

- Flutter supports `USE_DEVICE_ASR=true`.
- Flutter supports `DEVICE_ASR_PROVIDER=coreml_nemotron`.
- Flutter sends device ASR output as `client.text.segment`.
- iOS registers `translation_mobile/core_ml_nemotron_asr`.
- iOS checks and loads split Core ML bundles:
  `encoder.mlmodelc`, `decoder.mlmodelc`, `joint.mlmodelc`, and optional
  `preprocessor.mlmodelc` / `decoder_joint.mlmodelc`.
- iOS exposes `inspectModel` over MethodChannel to report Core ML
  input/output names and types.
- iOS has an `AVAudioEngine` input path that converts microphone audio to
  16 kHz mono float samples and cuts it into model chunks.
- iOS links `FluidAudio` and uses
  `StreamingNemotronMultilingualAsrManager` for Nemotron RNNT decoding.
- iOS emits Flutter `AsrTextSegment` partial/final events from native ASR.
- iOS has a simple RMS endpoint detector. After speech is followed by a
  silence window, the app finalizes the current ASR segment, emits `isFinal`,
  resets native ASR state, and starts a new segment ID.
- Flutter forwards device-ASR final text during `End`, before closing the
  realtime session.
- Simulator build passes, but real iPhone + real model audio still needs to be
  verified.

## Platform Scope

- iOS: Core AI / Core ML deployment is viable. Use the FluidInference
  CoreML Nemotron bundle through FluidAudio on iOS 17+ Apple Silicon devices.
  The smoke script rejects known iOS versions below 17 before launch.
- Android: Core ML cannot be deployed directly. Android needs a separate
  runtime path such as LiteRT, ONNX Runtime Mobile, or a server-side ASR
  fallback behind the same Flutter `MobileAsrProvider` interface.

## Model Placement

Use one of these paths:

```text
apps/mobile/ios/Runner/Models/NemotronASRStreaming/
apps/mobile/ios/Runner/Models/multilingual/2240ms/
Documents/Models/NemotronASRStreaming/
Documents/Models/multilingual/2240ms/
Documents/Models/latin/2240ms/
```

The second path is useful for local testing without committing large model files.

Validate a local bundle before building or copying it to a device:

```bash
scripts/validate_ios_nemotron_bundle.mjs \
  apps/mobile/ios/Runner/Models/multilingual/2240ms
```

To download, validate, and stage the default FluidInference multilingual tier
from Hugging Face:

```bash
scripts/download_ios_nemotron_bundle.mjs \
  --family multilingual \
  --tier 2240ms \
  --stage
```

The downloader supports `HF_TOKEN` / `HUGGINGFACE_TOKEN` for private or
rate-limited access and `HF_ENDPOINT` or `--endpoint` for a Hugging Face mirror.
Use `--dry-run` first to inspect the file plan without downloading.

If you have downloaded the FluidInference model outside the app, stage the
desired tier into the iOS Runner bundle candidates before building:

```bash
scripts/stage_ios_nemotron_bundle.mjs \
  /path/to/Nemotron-3.5-ASR-Streaming-Multilingual-0.6b-CoreML/multilingual/2240ms \
  --family multilingual \
  --tier 2240ms
```

Use `--dry-run` to preview the destination and `--force` only when replacing an
existing local model candidate.

The `Models` folder is part of the Runner target resources. After building, you
can confirm it was copied into the `.app` bundle:

```bash
scripts/check_ios_models_resource.mjs \
  apps/mobile/build/ios/iphonesimulator/Runner.app
```

For automation or detailed candidate inspection:

```bash
scripts/validate_ios_nemotron_bundle.mjs --json --allow-missing
```

## Run App With Device ASR

Check the Mac LAN IP that the physical iPhone should use:

```bash
npm run ios:nemotron:detect-lan-ip -- --json
```

If multiple network interfaces are active, set `MAC_LAN_INTERFACE=en0` to choose
one, or set `MAC_LAN_IP=YOUR_MAC_LAN_IP` for the orchestrated MVP scripts.

Check the default LM Studio translation Provider before the iPhone e2e:

```bash
npm run ios:nemotron:check-lmstudio -- --json
```

Use an existing local model bundle:

```bash
cd apps/mobile
flutter run -d DEVICE_ID \
  --dart-define=API_BASE_URL=http://YOUR_MAC_LAN_IP:3100 \
  --dart-define=USE_DEVICE_ASR=true \
  --dart-define=DEVICE_ASR_PROVIDER=coreml_nemotron \
  --dart-define=DEVICE_ASR_LANGUAGE=auto
```

Or allow the iPhone to download/cache the FluidInference model variant through
FluidAudio:

```bash
DEVICE_ID="Wha的iPhone" \
API_BASE_URL=http://YOUR_MAC_LAN_IP:3100 \
REALTIME_BASE_URL=http://YOUR_MAC_LAN_IP:3201 \
scripts/ios_nemotron_device_smoke.sh
```

App builds default to `DEVICE_ASR_AUTO_DOWNLOAD_MODEL=false` because the
CoreML bundle is large and may need network access to Hugging Face from the
device. The smoke script defaults it to `true` so a real-device validation can
exercise the resolve/download/prepare path unless you override it. The cached
model is reused by FluidAudio on later runs.

If you set `DEVICE_ASR_AUTO_DOWNLOAD_MODEL=false`, the smoke script checks
`apps/mobile/ios/Runner/Models` before launching any mode that will prepare or
start ASR. This catches the common case where the app would otherwise reach the
iPhone only to fail with `model_not_found`. Set
`DEVICE_ASR_SKIP_LOCAL_MODEL_PREFLIGHT=true` only when you intentionally rely on
a model already available in the iPhone Documents model cache.

The script selects a real iOS 17+ device first, then checks API `/health`,
Realtime Gateway `/health`, verifies that API `/health` reports the same
`realtimeWsEndpoint` as the Mac LAN Gateway URL, and launches the app with the
iOS Nemotron `dart-define` flags. It refuses to run on macOS, Chrome, Android,
or an iOS simulator by default. Use `ALLOW_IOS_SIMULATOR=true` only for
simulator dry runs. If Flutter reports that the iPhone is not visible, unlock
the device, connect it by cable or wireless development, ensure iOS Developer
Mode is enabled, and confirm the device is on iOS 17 or newer. When device
selection fails, the smoke script also runs `scripts/diagnose_ios_device.mjs`
so the failure includes `devicectl` state such as `pairingState`,
`developerModeStatus`, `tunnelState`, and the concrete reconnect actions.
You can run the diagnostic directly with:

```bash
DEVICE_ID="Wha的iPhone" scripts/diagnose_ios_device.mjs
```

The API server must also be started with
`REALTIME_WS_ENDPOINT` pointing at the same Mac LAN host and Gateway port, for
example `ws://YOUR_MAC_LAN_IP:3201/realtime`; `127.0.0.1` will fail on a real
iPhone because it points back to the phone itself. The iOS app declares
microphone and local-network usage descriptions plus `NSAllowsLocalNetworking`;
the smoke scripts verify these keys and localized permission strings before
launching microphone or Gateway modes.

In the app, open `端侧 ASR 诊断` and tap `检查服务` before running microphone
tests. The `服务连接` panel shows the configured API base URL, API health status,
service version, and the `realtimeWsEndpoint` returned by API `/health`. On a
real iPhone, any `127.0.0.1` endpoint shown here is invalid and must be replaced
with the Mac LAN IP before continuing.

To check only the iOS native Core ML / FluidAudio bridge before starting a
realtime session:

```bash
DEVICE_ID="Wha的iPhone" \
IOS_SMOKE_MODE=diagnostics \
scripts/ios_nemotron_device_smoke.sh
```

This prints `COREML_NEMOTRON_AVAILABILITY` from the MethodChannel and
`COREML_NEMOTRON_MODEL_SCAN` as a compact model-root summary. Add
`DEVICE_ASR_PREPARE_MODEL=true` to also call native `prepare`, which verifies
model resolve/download and `StreamingNemotronMultilingualAsrManager.loadModels`
before any microphone capture or Gateway session is opened. The availability
payload also includes `modelScan`, with candidate root count, selected root,
selected status, selected layout, and missing FluidAudio components, so a failed
real-device run records whether the app looked in the expected bundle or
Documents model locations. When prepare succeeds, the test also prints
`COREML_NEMOTRON_AVAILABILITY_AFTER_PREPARE` and
`COREML_NEMOTRON_MODEL_SCAN_AFTER_PREPARE`; `preparedModelReady=true` and
`decoderReady=true` prove FluidAudio has loaded the bundled, downloaded, or
cached model.

To verify the real iPhone microphone and Core ML / Nemotron ASR event stream
before opening a Gateway session:

```bash
DEVICE_ID="Wha的iPhone" \
IOS_SMOKE_MODE=selftest \
DEVICE_ASR_SELF_TEST_SECONDS=20 \
scripts/ios_nemotron_device_smoke.sh
```

Speak a short Chinese or English sentence while the test is running. The test
prints `COREML_NEMOTRON_SELF_TEST_AVAILABILITY`,
`COREML_NEMOTRON_SELF_TEST_MODEL_SCAN`,
`COREML_NEMOTRON_SELF_TEST_AVAILABILITY_AFTER_START`,
`COREML_NEMOTRON_SELF_TEST_AVAILABILITY_AFTER_STOP`,
`COREML_NEMOTRON_SELF_TEST_STARTED`,
`COREML_NEMOTRON_SELF_TEST_SEGMENT`, and
`COREML_NEMOTRON_SELF_TEST_RESULT`. By default it fails if no non-empty ASR
segment is received. Set `DEVICE_ASR_EXPECT_SEGMENT=false` only for dry runs
where you want to verify start/stop behavior without requiring speech. Selftest
logs segment character counts by default; set `DEVICE_ASR_LOG_TEXT=true` only
when you intentionally want recognized text printed in the test log.

To verify the real iPhone microphone, Core ML / Nemotron ASR, Gateway, API
session creation, translation event, and session save path in one command:

```bash
DEVICE_ID="Wha的iPhone" \
IOS_SMOKE_MODE=e2e \
API_BASE_URL=http://YOUR_MAC_LAN_IP:3100 \
REALTIME_BASE_URL=http://YOUR_MAC_LAN_IP:3201 \
DEVICE_ASR_E2E_SECONDS=45 \
scripts/ios_nemotron_device_smoke.sh
```

Run this with API Server and Realtime Gateway already started and reachable
from the iPhone. The e2e script defaults to `SERVER_OWNED_HISTORY=true`, so
Gateway `/health` must report `sessionEventSink=api`; start Gateway with
`SESSION_EVENT_SINK=api` and `API_BASE_URL=http://YOUR_MAC_LAN_IP:3100`.
Speak a short Chinese or English sentence, then pause so the native endpoint
detector can emit a final ASR segment. The test prints
`COREML_NEMOTRON_GATEWAY_E2E_API_HEALTH`,
`COREML_NEMOTRON_GATEWAY_E2E_GATEWAY_HEALTH`,
`COREML_NEMOTRON_GATEWAY_E2E_AVAILABILITY`,
`COREML_NEMOTRON_GATEWAY_E2E_MODEL_SCAN`,
`COREML_NEMOTRON_GATEWAY_E2E_AVAILABILITY_AFTER_START`,
`COREML_NEMOTRON_GATEWAY_E2E_AVAILABILITY_AFTER_STOP`,
`COREML_NEMOTRON_GATEWAY_E2E_SESSION`,
`COREML_NEMOTRON_GATEWAY_E2E_ASR_SENT`,
`COREML_NEMOTRON_GATEWAY_E2E_EVENT`,
`COREML_NEMOTRON_GATEWAY_E2E_HISTORY`, and
`COREML_NEMOTRON_GATEWAY_E2E_RESULT`. By default it fails unless a non-empty
ASR final segment is sent to Gateway and a non-empty `translation.final` is
received, then the ended session can be read back from API history with at
least one saved segment created by Gateway/API internal sync. Set
`DEVICE_ASR_EXPECT_TRANSLATION=false` only for dry runs. Set
`SERVER_OWNED_HISTORY=false` only when intentionally testing the older App-side
segment save and direct API end path.

For simulator-only diagnostics dry runs:

```bash
ALLOW_IOS_SIMULATOR=true \
IOS_SMOKE_MODE=diagnostics \
DEVICE_ID="iPhone 17 Pro" \
scripts/ios_nemotron_device_smoke.sh
```

Simulator diagnostics can prove the Flutter integration test reaches the iOS
native MethodChannel. It does not prove real microphone capture, real-device
performance, or Neural Engine behavior.

Before a real iPhone is available, verify the server half of the device-ASR
path with:

```bash
API_BASE_URL=http://127.0.0.1:3100 \
TEXT_SEGMENT_SOURCE_TEXT="hello from native device asr" \
scripts/realtime_text_segment_smoke.mjs
```

Run this with API Server and Realtime Gateway already started, with
`SESSION_EVENT_SINK=api` on the Gateway. The script creates a realtime session,
sends one final `client.text.segment`, first confirms Gateway `/health` reports
`sessionEventSink=api`, waits for transcript and translation events, ends the
session through Gateway, and confirms API history contains the translated
segment with session `status=ended`.

## Expected MVP Behavior Now

Without the model bundle:

```text
model_not_found
```

With a valid FluidInference tier bundle:

```text
partial/final AsrTextSegment events
```

With an older split-only bundle that lacks `preprocessor.mlmodelc`,
`metadata.json`, or `tokenizer.json`:

```text
model_incomplete
```

If the app was built without the FluidAudio Swift package:

```text
fluidaudio_unavailable
```

The native `isAvailable` payload now distinguishes:

```text
ready                  local FluidAudio-compatible model is available
model_incomplete       a split bundle exists but lacks FluidAudio files
model_not_found        no local bundle found
fluidaudio_unavailable app was built without the FluidAudio Swift package
```

When `DEVICE_ASR_AUTO_DOWNLOAD_MODEL=true`, `model_not_found` and
`model_incomplete` can still be resolved during `start` if the device can reach
the FluidInference model repo.

Flutter performs this availability check before creating the realtime session.
If local ASR cannot start and auto-download is off, the app shows the native
reason instead of opening a session that cannot send speech.
When auto-download is on, Flutter calls native `prepare` before creating the
realtime session. That prepare phase downloads/caches and loads the Nemotron
model, so model failures happen before the API session starts.
During this phase, the app status bar shows whether it is preparing a local
model or downloading one, then switches to realtime connection once the model
is ready.

## Real Device Smoke Checklist

Use `docs/poc/ios-coreml-nemotron-smoke-checklist.md` for the physical iPhone
readiness gate, service startup commands, selftest/e2e acceptance signals,
CoreSimulator recovery notes, remaining work, and model source notes.
