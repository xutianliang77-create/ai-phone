import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  checkLiveKitSelfHostConfig,
  parseEnvFile,
  renderLiveKitSelfHostFiles,
} from "./livekit_selfhost_config.mjs";

describe("checkLiveKitSelfHostConfig", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  test("passes with reviewed self-host domains and secrets", () => {
    const file = writeEnv(tempDirs, readyEnv());

    const result = checkLiveKitSelfHostConfig({ envFile: file });

    expect(result.status).toBe("ready");
    expect(result.issues).toEqual([]);
    expect(result.releaseSnippet).toBe("LIVEKIT_URL=wss://livekit.qkxy.cn");
  });

  test("fails placeholders, shared domains, weak secrets and bad ports", () => {
    const file = writeEnv(
      tempDirs,
      readyEnv({
        LIVEKIT_DOMAIN: "livekit.example.cn",
        LIVEKIT_TURN_DOMAIN: "livekit.example.cn",
        LIVEKIT_API_KEY: "bad key",
        LIVEKIT_API_SECRET: "short",
        LIVEKIT_RTC_PORT_START: "60000",
        LIVEKIT_RTC_PORT_END: "50000",
      }),
    );

    const result = checkLiveKitSelfHostConfig({ envFile: file });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain("LiveKit self-host invalid LIVEKIT_DOMAIN");
    expect(result.issues).toContain(
      "LiveKit self-host TURN domain must differ from primary domain",
    );
    expect(result.issues).toContain("LiveKit self-host invalid LIVEKIT_API_KEY");
    expect(result.issues).toContain("LiveKit self-host weak LIVEKIT_API_SECRET");
    expect(result.issues).toContain("LiveKit self-host invalid LIVEKIT_RTC_PORT_RANGE");
  });

  test("requires cert and key paths when TURN TLS is enabled", () => {
    const file = writeEnv(
      tempDirs,
      readyEnv({
        LIVEKIT_ENABLE_TURN_TLS: "true",
        LIVEKIT_TURN_TLS_CERT_FILE: "",
        LIVEKIT_TURN_TLS_KEY_FILE: "",
      }),
    );

    const result = checkLiveKitSelfHostConfig({ envFile: file });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain(
      "LiveKit self-host missing LIVEKIT_TURN_TLS_CERT_FILE",
    );
    expect(result.issues).toContain(
      "LiveKit self-host missing LIVEKIT_TURN_TLS_KEY_FILE",
    );
  });

  test("renders deployment files and release env snippet", () => {
    const files = renderLiveKitSelfHostFiles(parseEnvFile(readyEnvText()));

    expect(files["livekit.yaml"]).toContain("port: 7880");
    expect(files["livekit.yaml"]).toContain('"livekit_qkxy_prod"');
    expect(files["docker-compose.yaml"]).toContain("network_mode: host");
    expect(files.Caddyfile).toContain("reverse_proxy 127.0.0.1:7880");
    expect(files["release.env.snippet"]).toContain("LIVEKIT_URL=wss://livekit.qkxy.cn");
  });
});

function writeEnv(tempDirs, values) {
  const root = mkdtempSync(path.join(tmpdir(), "translation-livekit-"));
  tempDirs.push(root);
  mkdirSync(root, { recursive: true });
  const file = path.join(root, ".env");
  writeFileSync(
    file,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
  );
  return file;
}

function readyEnvText() {
  const file = writeEnv([], readyEnv());
  const text = readFileSync(file, "utf8");
  rmSync(path.dirname(file), { recursive: true, force: true });
  return text;
}

function readyEnv(overrides = {}) {
  return {
    LIVEKIT_DOMAIN: "livekit.qkxy.cn",
    LIVEKIT_TURN_DOMAIN: "turn-livekit.qkxy.cn",
    LIVEKIT_API_KEY: "livekit_qkxy_prod",
    LIVEKIT_API_SECRET: "livekit_prod_secret_123456789012",
    LIVEKIT_HTTP_PORT: "7880",
    LIVEKIT_RTC_TCP_PORT: "7881",
    LIVEKIT_RTC_PORT_START: "50000",
    LIVEKIT_RTC_PORT_END: "60000",
    LIVEKIT_TURN_UDP_PORT: "3478",
    LIVEKIT_ENABLE_TURN_TLS: "false",
    ...overrides,
  };
}
