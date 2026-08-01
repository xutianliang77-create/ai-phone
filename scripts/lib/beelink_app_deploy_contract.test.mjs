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

describe("Beelink app deployment contract", () => {
  it("builds before freezing writes and migrates before enabling SQLite", () => {
    expectInOrder([
      'remote_compose "build"',
      'remote_compose "stop gateway api"',
      "api-store.json.backup-$backup_stamp",
      "npm run storage:migrate-json",
      "npm run storage:check",
      "npm run storage:backup",
      "set_env API_STORAGE_DRIVER sqlite",
      'remote_compose "up -d --no-build --remove-orphans"',
    ]);
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
      "container_name: ${AI_PHONE_CONTAINER_PREFIX:-ai-phone}-api",
    );
    expect(compose).toContain(
      "container_name: ${AI_PHONE_CONTAINER_PREFIX:-ai-phone}-translation-agent",
    );
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
