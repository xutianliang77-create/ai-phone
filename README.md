# ai phone

Cross-platform AI translation and calling application for iOS and Android.

## Repository layout

- `apps/mobile`: Flutter mobile application.
- `services/api-server`: account, session, history, usage, and review APIs.
- `services/realtime-gateway`: realtime audio, ASR, translation, and TTS routing.
- `services/translation-worker`: LiveKit and call translation worker.
- `services/model-services`: Python ASR, translation, and TTS services.
- `packages`: shared TypeScript contracts and provider abstractions.
- `infra`: server deployment templates.
- `docs`: product, architecture, development, and acceptance documents.

## Restore a development checkout

```bash
npm ci
cd apps/mobile
flutter pub get
```

Copy the required `.env.example` files to local `.env` files and provide your
own secrets. Model weights, runtime databases, voice recordings, generated
audio, build products, and signing keys are intentionally excluded from Git.

## iOS device build

Standalone device testing must use Profile or Release. Debug builds should only
run while attached to Flutter tooling or Xcode.

```bash
DEVICE_ID=<iphone-device-id> \
SERVER_BASE_URL=https://your-server.example.com \
scripts/install_ios_profile_test.sh
```

The installer checks server health and rejects Debug Flutter artifacts before
installing the App.

## Architecture

The target runtime contains two deployment nodes only: the mobile App and one
server deployment. See
[`docs/ai-phone-two-tier-deployment-data-flow-design.md`](docs/ai-phone-two-tier-deployment-data-flow-design.md).

