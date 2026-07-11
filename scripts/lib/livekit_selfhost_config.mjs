import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const DEFAULTS = {
  LIVEKIT_IMAGE: "livekit/livekit-server:latest",
  LIVEKIT_REDIS_IMAGE: "redis:7-alpine",
  LIVEKIT_CADDY_IMAGE: "caddy:2-alpine",
  LIVEKIT_HTTP_PORT: "7880",
  LIVEKIT_RTC_TCP_PORT: "7881",
  LIVEKIT_RTC_PORT_START: "50000",
  LIVEKIT_RTC_PORT_END: "60000",
  LIVEKIT_TURN_UDP_PORT: "3478",
  LIVEKIT_ENABLE_TURN_TLS: "false",
  LIVEKIT_TURN_TLS_PORT: "5349",
};

const REQUIRED_TEXT = [
  "LIVEKIT_DOMAIN",
  "LIVEKIT_TURN_DOMAIN",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
];

export function checkLiveKitSelfHostConfig(options = {}) {
  const root = options.root ?? process.cwd();
  const envFile = path.resolve(
    root,
    options.envFile ?? "infra/livekit-selfhost/.env",
  );
  if (!options.envText && !existsSync(envFile)) {
    return result(envFile, [], [`LiveKit self-host env file missing: ${envFile}`]);
  }
  const env = normalizeEnv(
    parseEnvFile(options.envText ?? readFileSync(envFile, "utf8")),
  );
  const checks = [];
  const issues = [];
  requireText(env, checks, issues);
  requireDomains(env, checks, issues);
  requireSecrets(env, checks, issues);
  requirePorts(env, checks, issues);
  requireTurnTls(env, checks, issues);
  return result(envFile, checks, issues, env);
}

export function renderLiveKitSelfHostFiles(envInput) {
  const env = normalizeEnv(envInput);
  const config = toConfig(env);
  return {
    "livekit.yaml": renderLiveKitYaml(config),
    "docker-compose.yaml": renderDockerCompose(config),
    Caddyfile: renderCaddyfile(config),
    "redis.conf": renderRedisConf(),
    "release.env.snippet": renderReleaseEnvSnippet(config),
  };
}

export function parseEnvFile(text) {
  const env = {};
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const normalized = trimmed.startsWith("export ")
      ? trimmed.slice(7).trim()
      : trimmed;
    const index = normalized.indexOf("=");
    if (index === -1) continue;
    const key = normalized.slice(0, index).trim();
    env[key] = unquote(normalized.slice(index + 1).trim());
  }
  return env;
}

function requireText(env, checks, issues) {
  for (const key of REQUIRED_TEXT) {
    const ok = hasRealValue(env[key]);
    record(checks, key, ok, { configured: ok });
    if (!ok) issues.push(`LiveKit self-host env missing ${key}`);
  }
}

function requireDomains(env, checks, issues) {
  const livekitOk = isPublicDomain(env.LIVEKIT_DOMAIN);
  record(checks, "LIVEKIT_DOMAIN_public", livekitOk, {
    value: env.LIVEKIT_DOMAIN ?? "",
  });
  if (!livekitOk) issues.push("LiveKit self-host invalid LIVEKIT_DOMAIN");

  const turnOk = isPublicDomain(env.LIVEKIT_TURN_DOMAIN);
  record(checks, "LIVEKIT_TURN_DOMAIN_public", turnOk, {
    value: env.LIVEKIT_TURN_DOMAIN ?? "",
  });
  if (!turnOk) issues.push("LiveKit self-host invalid LIVEKIT_TURN_DOMAIN");

  const distinct =
    hasRealValue(env.LIVEKIT_DOMAIN) &&
    hasRealValue(env.LIVEKIT_TURN_DOMAIN) &&
    env.LIVEKIT_DOMAIN !== env.LIVEKIT_TURN_DOMAIN;
  record(checks, "LIVEKIT_TURN_DOMAIN_distinct", distinct, {
    livekitDomain: env.LIVEKIT_DOMAIN ?? "",
    turnDomain: env.LIVEKIT_TURN_DOMAIN ?? "",
  });
  if (!distinct) {
    issues.push("LiveKit self-host TURN domain must differ from primary domain");
  }
}

function requireSecrets(env, checks, issues) {
  const keyOk =
    hasRealValue(env.LIVEKIT_API_KEY) && /^[A-Za-z0-9_-]{6,64}$/.test(env.LIVEKIT_API_KEY);
  record(checks, "LIVEKIT_API_KEY_format", keyOk, {
    minLength: 6,
    actualLength: env.LIVEKIT_API_KEY?.length ?? 0,
  });
  if (!keyOk) issues.push("LiveKit self-host invalid LIVEKIT_API_KEY");

  const secretOk = hasRealValue(env.LIVEKIT_API_SECRET) && env.LIVEKIT_API_SECRET.length >= 32;
  record(checks, "LIVEKIT_API_SECRET_strength", secretOk, {
    minLength: 32,
    actualLength: env.LIVEKIT_API_SECRET?.length ?? 0,
  });
  if (!secretOk) issues.push("LiveKit self-host weak LIVEKIT_API_SECRET");
}

function requirePorts(env, checks, issues) {
  const names = [
    "LIVEKIT_HTTP_PORT",
    "LIVEKIT_RTC_TCP_PORT",
    "LIVEKIT_TURN_UDP_PORT",
  ];
  for (const name of names) {
    const ok = isPort(env[name]);
    record(checks, name, ok, { value: env[name] });
    if (!ok) issues.push(`LiveKit self-host invalid ${name}`);
  }
  const start = Number(env.LIVEKIT_RTC_PORT_START);
  const end = Number(env.LIVEKIT_RTC_PORT_END);
  const rangeOk = isPort(start) && isPort(end) && end > start && end - start >= 100;
  record(checks, "LIVEKIT_RTC_PORT_RANGE", rangeOk, { start, end });
  if (!rangeOk) issues.push("LiveKit self-host invalid LIVEKIT_RTC_PORT_RANGE");
}

function requireTurnTls(env, checks, issues) {
  const enabled = env.LIVEKIT_ENABLE_TURN_TLS === "true";
  record(checks, "LIVEKIT_ENABLE_TURN_TLS", true, { enabled });
  if (!enabled) return;
  const portOk = isPort(env.LIVEKIT_TURN_TLS_PORT);
  const certOk = hasRealValue(env.LIVEKIT_TURN_TLS_CERT_FILE);
  const keyOk = hasRealValue(env.LIVEKIT_TURN_TLS_KEY_FILE);
  record(checks, "LIVEKIT_TURN_TLS_PORT", portOk, {
    value: env.LIVEKIT_TURN_TLS_PORT,
  });
  record(checks, "LIVEKIT_TURN_TLS_CERT_FILE", certOk, { configured: certOk });
  record(checks, "LIVEKIT_TURN_TLS_KEY_FILE", keyOk, { configured: keyOk });
  if (!portOk) issues.push("LiveKit self-host invalid LIVEKIT_TURN_TLS_PORT");
  if (!certOk) issues.push("LiveKit self-host missing LIVEKIT_TURN_TLS_CERT_FILE");
  if (!keyOk) issues.push("LiveKit self-host missing LIVEKIT_TURN_TLS_KEY_FILE");
}

function normalizeEnv(env) {
  return { ...DEFAULTS, ...env };
}

function toConfig(env) {
  return {
    domain: env.LIVEKIT_DOMAIN,
    turnDomain: env.LIVEKIT_TURN_DOMAIN,
    apiKey: env.LIVEKIT_API_KEY,
    apiSecret: env.LIVEKIT_API_SECRET,
    image: env.LIVEKIT_IMAGE,
    redisImage: env.LIVEKIT_REDIS_IMAGE,
    caddyImage: env.LIVEKIT_CADDY_IMAGE,
    httpPort: Number(env.LIVEKIT_HTTP_PORT),
    rtcTcpPort: Number(env.LIVEKIT_RTC_TCP_PORT),
    rtcPortStart: Number(env.LIVEKIT_RTC_PORT_START),
    rtcPortEnd: Number(env.LIVEKIT_RTC_PORT_END),
    turnUdpPort: Number(env.LIVEKIT_TURN_UDP_PORT),
    turnTlsEnabled: env.LIVEKIT_ENABLE_TURN_TLS === "true",
    turnTlsPort: Number(env.LIVEKIT_TURN_TLS_PORT),
    turnTlsCertFile: env.LIVEKIT_TURN_TLS_CERT_FILE,
    turnTlsKeyFile: env.LIVEKIT_TURN_TLS_KEY_FILE,
  };
}

function renderLiveKitYaml(config) {
  return [
    "port: " + config.httpPort,
    "log_level: info",
    "",
    "rtc:",
    "  tcp_port: " + config.rtcTcpPort,
    "  port_range_start: " + config.rtcPortStart,
    "  port_range_end: " + config.rtcPortEnd,
    "  use_external_ip: true",
    "",
    "redis:",
    "  address: 127.0.0.1:6379",
    "",
    "keys:",
    `  ${yamlQuote(config.apiKey)}: ${yamlQuote(config.apiSecret)}`,
    "",
    "turn:",
    "  enabled: true",
    "  domain: " + config.turnDomain,
    "  udp_port: " + config.turnUdpPort,
    ...renderTurnTls(config),
    "",
  ].join("\n");
}

function renderTurnTls(config) {
  if (!config.turnTlsEnabled) return [];
  return [
    "  tls_port: " + config.turnTlsPort,
    "  cert_file: " + config.turnTlsCertFile,
    "  key_file: " + config.turnTlsKeyFile,
  ];
}

function renderDockerCompose(config) {
  return `services:
  livekit:
    image: ${config.image}
    command: ["--config", "/etc/livekit.yaml"]
    network_mode: host
    restart: unless-stopped
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml:ro

  redis:
    image: ${config.redisImage}
    command: ["redis-server", "/etc/redis.conf"]
    network_mode: host
    restart: unless-stopped
    volumes:
      - ./redis.conf:/etc/redis.conf:ro
      - ./redis_data:/data

  caddy:
    image: ${config.caddyImage}
    network_mode: host
    restart: unless-stopped
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./caddy_data:/data
      - ./caddy_config:/config
`;
}

function renderCaddyfile(config) {
  return `${config.domain} {
  reverse_proxy 127.0.0.1:${config.httpPort}
}
`;
}

function renderRedisConf() {
  return `bind 127.0.0.1
protected-mode yes
port 6379
appendonly yes
dir /data
`;
}

function renderReleaseEnvSnippet(config) {
  return `CALL_ROOM_PROVIDER=livekit
LIVEKIT_URL=wss://${config.domain}
LIVEKIT_API_KEY=${config.apiKey}
LIVEKIT_API_SECRET=${config.apiSecret}
CALL_ROOM_TOKEN_TTL_SECONDS=3600
`;
}

function hasRealValue(value) {
  return typeof value === "string" && value.trim() !== "" && !isPlaceholder(value);
}

function isPlaceholder(value) {
  return /required|replace|example|your-|todo|待填|localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(
    String(value ?? ""),
  );
}

function isPublicDomain(value) {
  if (!hasRealValue(value)) return false;
  if (/^https?:|^wss?:/i.test(value)) return false;
  if (/[/:]/.test(value)) return false;
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(value);
}

function isPort(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 65535;
}

function unquote(value) {
  return value.replace(/^["']|["']$/g, "");
}

function yamlQuote(value) {
  return JSON.stringify(String(value));
}

function record(checks, name, ok, details = {}) {
  checks.push({ name, status: ok ? "pass" : "fail", details });
}

function result(envFile, checks, issues, env = {}) {
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    envFile,
    releaseSnippet: issues.length === 0 ? `LIVEKIT_URL=wss://${env.LIVEKIT_DOMAIN}` : null,
    checks,
    issues,
    actions:
      issues.length === 0
        ? []
        : [
            "Fill infra/livekit-selfhost/.env with production domains and secrets, then rerun this check.",
          ],
  };
}
