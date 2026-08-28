import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync(
  new URL("../deploy_beelink_app_services.sh", import.meta.url),
  "utf8",
);
const llmScript = readFileSync(
  new URL("../deploy_beelink_llm_service.sh", import.meta.url),
  "utf8",
);
const modelScript = readFileSync(
  new URL("../deploy_beelink_model_services.sh", import.meta.url),
  "utf8",
);
const ttsScript = readFileSync(
  new URL("../deploy_beelink_voxcpm2_tts_service.sh", import.meta.url),
  "utf8",
);
const candidateScript = readFileSync(
  new URL("../deploy_beelink_core_candidate.sh", import.meta.url),
  "utf8",
);
const listeningGatewayScript = readFileSync(
  new URL("../deploy_beelink_listening_gateway_overlay.sh", import.meta.url),
  "utf8",
);
const listeningAsrCandidateScript = readFileSync(
  new URL(
    "../deploy_beelink_qwen17_moss_listening_candidate.sh",
    import.meta.url,
  ),
  "utf8",
);
const iosProfileInstallScript = readFileSync(
  new URL("../install_ios_profile_test.sh", import.meta.url),
  "utf8",
);
const compose = readFileSync(
  new URL("../../infra/ai-phone-server/docker-compose.yaml", import.meta.url),
  "utf8",
);
const appEntrypoint = readFileSync(
  new URL("../../infra/ai-phone-server/app-container-entrypoint.mjs", import.meta.url),
  "utf8",
);
const dockerfile = readFileSync(
  new URL("../../infra/ai-phone-server/Dockerfile", import.meta.url),
  "utf8",
);
const rootPackage = JSON.parse(readFileSync(
  new URL("../../package.json", import.meta.url),
  "utf8",
));

describe("Beelink app deployment contract", () => {
  it("requires an explicit production profile and fails closed before env generation", () => {
    expect(script).toContain('AI_PHONE_DEPLOY_PROFILE="${AI_PHONE_DEPLOY_PROFILE:-test}"');
    expect(script).toContain("production_env_preflight");
    expect(script).toContain("refusing to generate a test env");
    expect(script).toContain("require_value API_TEST_AUTO_ACCOUNT false");
    expect(script).toContain("require_value API_STORAGE_DRIVER postgres");
    expect(script).toContain("Production profile requires $key to bind loopback");
    expect(script).toContain("Production profile requires an explicit REALTIME_WS_ENDPOINT=wss://...");
  });

  it("keeps translation ingest cadence and bounded capacity explicit", () => {
    expect(script).toContain(
      'TRANSLATION_WORKER_AUDIO_FRAME_SIZE_MS="${TRANSLATION_WORKER_AUDIO_FRAME_SIZE_MS:-200}"',
    );
    expect(script).toContain(
      'TRANSLATION_WORKER_AUDIO_INGEST_MAX_FRAMES="${TRANSLATION_WORKER_AUDIO_INGEST_MAX_FRAMES:-40}"',
    );
    expect(script).toContain('set_env TRANSLATION_WORKER_AUDIO_FRAME_SIZE_MS');
    expect(script).toContain('set_env TRANSLATION_WORKER_AUDIO_INGEST_MAX_FRAMES');
  });

  it("builds before freezing writes and migrates before enabling SQLite", () => {
    expectInOrder([
      'remote_compose "build"',
      'remote_compose "stop wujie-ai"',
      "api-store.json.backup-$backup_stamp",
      "npm run storage:migrate-json",
      "npm run storage:check",
      "npm run storage:backup",
      "set_env API_STORAGE_DRIVER sqlite",
      'remote_compose "up -d --no-build --remove-orphans"',
    ]);
  });

  it("provides a pinned-image fast start without rebuilding or syncing", () => {
    expect(script).toContain("sync|deploy|start|status");
    expect(script).toContain("ai-phone-image-tag");
    expect(script).toContain('TTS_READINESS_URL="${TTS_READINESS_URL:-http://$TTS_SERVICE_HOST:8002/health}"');
    expect(script).toContain('if [[ \"$MODE\" == \"start\" ]]; then');
    expect(script).toContain("remote_compose 'up -d --no-build --remove-orphans'");
    expect(script).not.toContain('remote_compose \"build\"\n  wait_for_translation_agent_stability');
  });

  it("preserves an existing database before a fresh JSON migration", () => {
    expect(script).toContain("api-store.sqlite.pre-migration-$backup_stamp");
    expect(script).not.toContain("rm -f '$REMOTE_RUNTIME/data/api-store.sqlite'");
  });

  it("routes authorized voice identity calls to the speaker service", () => {
    expect(script).toContain(
      'SPEAKER_HTTP_BASE_URL="${SPEAKER_HTTP_BASE_URL:-http://$SPEAKER_SERVICE_HOST:8022}"',
    );
    expect(script).toContain(
      'VOICE_IDENTITY_HTTP_BASE_URL="${VOICE_IDENTITY_HTTP_BASE_URL:-$SPEAKER_HTTP_BASE_URL}"',
    );
    expect(script).toContain(
      'set_env VOICE_IDENTITY_HTTP_BASE_URL "$VOICE_IDENTITY_HTTP_BASE_URL"',
    );
    expect(script).toContain('set_env VOICE_IDENTITY_HTTP_TIMEOUT_MS "30000"');
  });

  it("keeps server endpoints configurable and LLM off loopback", () => {
    for (const name of [
      "API_BIND_HOST",
      "REALTIME_BIND_HOST",
      "LIVEKIT_AGENT_BIND_HOST",
      "VOICE_AGENT_BIND_HOST",
      "SRT_INGRESS_BIND_HOST",
      "TRANSLATION_WORKER_AUDIO_FRAME_SINK_HOST",
    ]) {
      expect(script).toMatch(
        new RegExp(`set_env\\s+${name}\\s+"\\$${name}"`),
      );
    }
    for (const name of [
      "ASR_SERVICE_HOST",
      "SPEAKER_SERVICE_HOST",
      "TRANSLATION_SERVICE_HOST",
      "TTS_SERVICE_HOST",
    ]) {
      expect(script).toContain(`${name}=\"\${${name}:-$PUBLIC_HOST}\"`);
    }
    expect(script).toContain('LLM_SERVICE_HOST="${LLM_SERVICE_HOST:-$PUBLIC_HOST}"');
    expect(script).toContain('LLM_BASE_URL="${LLM_BASE_URL:-http://$LLM_SERVICE_HOST:1234/v1}"');
    expect(script).toContain('set_env LLM_BASE_URL "$LLM_BASE_URL"');
    expect(llmScript).toContain(
      'LLM_BIND_ADDRESS="${LLM_BIND_ADDRESS:-${BEELINK_TAILSCALE_IP:-100.110.127.117}}"',
    );
    expect(llmScript).toContain(
      "LLM_BIND_ADDRESS must be a server-reachable non-loopback address",
    );
    expect(modelScript).toContain(
      "--host $MODEL_SERVICE_BIND_ADDRESS --port $port",
    );
    expect(ttsScript).toContain(
      "--host $TTS_BIND_ADDRESS --port $TTS_SERVICE_PORT",
    );
    expect(ttsScript).toContain('curl -sS "$TTS_HEALTH_URL"');
  });

  it("keeps the production candidate isolated and fail-closed", () => {
    expect(candidateScript).toContain(
      "check_core_translation_candidate_deploy.mjs",
    );
    expect(candidateScript).toContain("test \"$(stat -c '%a' \"$incoming\")\" = \"600\"");
    expect(candidateScript).toContain("install -m 600");
    expect(candidateScript).toContain("server.env.rollback");
    expect(candidateScript).toContain("--exclude='PROGRESS_LOG.md'");
    expect(candidateScript).toContain("--exclude='release/domestic/release.env'");
    expect(candidateScript).toContain("docker compose -p '$COMPOSE_PROJECT_NAME'");
    expect(candidateScript).not.toContain("tailscale serve");
    expect(compose).toContain(
      "container_name: ${AI_PHONE_CONTAINER_PREFIX:-ai-phone}-wujie-ai",
    );
    expect(compose).toContain("app-container-entrypoint.mjs");
    expect(compose).toContain("container-healthcheck.mjs");
    expect(dockerfile).toContain("container-healthcheck.mjs");
    expect(appEntrypoint).toContain('services/translation-worker/dist/agent-calls/main.js');
    expect(compose).not.toContain(
      "container_name: ${AI_PHONE_CONTAINER_PREFIX:-ai-phone}-api",
    );
    expect(compose).not.toContain(
      "container_name: ${AI_PHONE_CONTAINER_PREFIX:-ai-phone}-translation-agent",
    );
  });

  it("builds runtime dependencies only from the committed lockfile", () => {
    expect(rootPackage.optionalDependencies).toMatchObject({
      "@ffmpeg-installer/linux-x64": "4.1.0",
    });
    expect(dockerfile).toContain("RUN npm ci &&");
    expect(dockerfile).toContain(
      "test -x node_modules/@ffmpeg-installer/linux-x64/ffmpeg",
    );
    expect(dockerfile).toContain("npm prune --omit=dev");
    expect(dockerfile).not.toContain("npm install --no-save");
    expect(dockerfile).not.toContain("--package-lock=false");
  });

  it("gates the listening deployment on real Hy-MT2 and meeting speaker services", () => {
    expect(listeningGatewayScript).toContain(
      'TRANSLATION_SERVICE_URL="${TRANSLATION_SERVICE_URL:-http://127.0.0.1:8003}"',
    );
    expect(listeningGatewayScript).toContain(
      'SPEAKER_SERVICE_URL="${SPEAKER_SERVICE_URL:-http://127.0.0.1:8022}"',
    );
    expect(listeningGatewayScript).toContain(
      'REQUIRE_SPEAKER="${REQUIRE_SPEAKER:-true}"',
    );
    expect(listeningGatewayScript).toContain(
      'source = "API 订单 A-120 的金额是 20,000 元。"',
    );
    expect(listeningGatewayScript).toContain(
      'for entity in ("API", "A-120", "20,000"):',
    );
    expect(listeningGatewayScript).toContain("assert_model_dependencies true");
    expect(listeningGatewayScript).toContain("assert_model_dependencies false");
  });

  it("deploys bounded Qwen listening finals with an independent token budget", () => {
    expect(listeningAsrCandidateScript).toContain(
      "QWEN17_FINAL_MAX_NEW_TOKENS=256",
    );
    expect(listeningAsrCandidateScript).toContain(
      "QWEN17_UNFIXED_CHUNK_NUM=7",
    );
    expect(listeningAsrCandidateScript).toContain(
      "ASR_LISTENING_MAX_AUDIO_MS=10000",
    );
    expect(listeningAsrCandidateScript).toContain(
      "ASR_LISTENING_VAD_PROVIDER=marblenet",
    );
    expect(listeningAsrCandidateScript).toContain(
      "ASR_LISTENING_VAD_THRESHOLD=0.05",
    );
    expect(listeningAsrCandidateScript).toContain(
      "ASR_LISTENING_VAD_WINDOW_MS=1000",
    );
    expect(listeningAsrCandidateScript).toContain(
      "ASR_LISTENING_VAD_SMOOTHING_FRAMES=3",
    );
    expect(listeningAsrCandidateScript).toContain(
      "ASR_LISTENING_VAD_RMS_THRESHOLD=20",
    );
    expect(listeningAsrCandidateScript).toContain(
      'test -f \'$VAD_MODEL_PATH\'',
    );
    expect(listeningAsrCandidateScript).toContain(
      'vad.get("activeProvider") == "marblenet"',
    );
    expect(listeningAsrCandidateScript).toContain(
      '"$DIAGNOSTIC_CAPTURE_DIR" == "$REMOTE_ROOT"/diagnostic-captures/*',
    );
    expect(listeningAsrCandidateScript).toContain(
      "ASR_LISTENING_DIAGNOSTIC_CAPTURE_MAX_SESSIONS=$DIAGNOSTIC_CAPTURE_MAX_SESSIONS",
    );
  });

  it("builds the iOS test candidate with an explicit validated realtime mode", () => {
    expect(iosProfileInstallScript).toContain(
      'REALTIME_MODE="${REALTIME_MODE:-conversation}"',
    );
    expect(iosProfileInstallScript).toContain(
      "conversation|meeting|classroom|business",
    );
    expect(iosProfileInstallScript).toContain(
      '--dart-define="REALTIME_MODE=$REALTIME_MODE"',
    );
    expect(iosProfileInstallScript).toContain(
      "curl --noproxy '*' --fail --silent --show-error",
    );
  });
});

function expectInOrder(markers) {
  let previous = -1;
  for (const marker of markers) {
    const index = script.indexOf(marker);
    expect(index, marker).toBeGreaterThan(previous);
    previous = index;
  }
}
