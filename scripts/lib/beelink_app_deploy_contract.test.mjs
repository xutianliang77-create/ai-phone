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
});

function expectInOrder(markers) {
  let previous = -1;
  for (const marker of markers) {
    const index = script.indexOf(marker);
    expect(index, marker).toBeGreaterThan(previous);
    previous = index;
  }
}
