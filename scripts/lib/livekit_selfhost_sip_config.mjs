export const SIP_DEFAULTS = {
  LIVEKIT_SIP_IMAGE: "livekit/sip:v1.7.0",
  LIVEKIT_SIP_PORT: "5060",
  LIVEKIT_SIP_RTP_PORT_START: "10000",
  LIVEKIT_SIP_RTP_PORT_END: "20000",
  LIVEKIT_SIP_HEALTH_PORT: "7888",
  LIVEKIT_SIP_PROMETHEUS_PORT: "6788",
  LIVEKIT_SIP_INBOUND_ENABLED: "false",
  LIVEKIT_SIP_INBOUND_DEDICATED_TRUNK: "false",
};

export const SIP_REQUIRED_TEXT = [
  "LIVEKIT_WEBHOOK_URL",
  "LIVEKIT_SIP_OUTBOUND_TRUNK_ID",
];

export function validateLiveKitSipEnv(env, checks, issues) {
  const webhookOk = isPublicHttpsUrl(env.LIVEKIT_WEBHOOK_URL);
  record(checks, "LIVEKIT_WEBHOOK_URL_public_https", webhookOk, {
    configured: webhookOk,
  });
  if (!webhookOk) issues.push("LiveKit self-host invalid LIVEKIT_WEBHOOK_URL");

  const trunkOk = /^ST_[A-Za-z0-9_-]{6,}$/.test(
    env.LIVEKIT_SIP_OUTBOUND_TRUNK_ID ?? "",
  );
  record(checks, "LIVEKIT_SIP_OUTBOUND_TRUNK_ID", trunkOk, {
    configured: trunkOk,
  });
  if (!trunkOk) {
    issues.push("LiveKit self-host invalid LIVEKIT_SIP_OUTBOUND_TRUNK_ID");
  }

  if (env.LIVEKIT_SIP_INBOUND_ENABLED === "true") {
    const inboundTrunkOk = /^ST_[A-Za-z0-9_-]{6,}$/.test(
      env.LIVEKIT_SIP_INBOUND_TRUNK_ID ?? "",
    );
    const dedicated = env.LIVEKIT_SIP_INBOUND_DEDICATED_TRUNK === "true";
    const displayNumber = /^\+[1-9]\d{7,14}$/.test(
      env.LIVEKIT_SIP_INBOUND_DISPLAY_NUMBER ?? "",
    );
    record(checks, "LIVEKIT_SIP_INBOUND_TRUNK_ID", inboundTrunkOk, {
      configured: inboundTrunkOk,
    });
    record(checks, "LIVEKIT_SIP_INBOUND_DEDICATED_TRUNK", dedicated, {
      dedicated,
    });
    record(checks, "LIVEKIT_SIP_INBOUND_DISPLAY_NUMBER", displayNumber, {
      configured: displayNumber,
    });
    if (!inboundTrunkOk || !dedicated || !displayNumber) {
      issues.push("LiveKit self-host inbound SIP requires dedicated trunk and E.164 number");
    }
  }

  const imageOk = isImmutableImage(env.LIVEKIT_SIP_IMAGE);
  record(checks, "LIVEKIT_SIP_IMAGE", imageOk, { digestPinned: imageOk });
  if (!imageOk) {
    issues.push("LiveKit self-host LIVEKIT_SIP_IMAGE must use tag and sha256 digest");
  }

  for (const name of [
    "LIVEKIT_SIP_PORT",
    "LIVEKIT_SIP_HEALTH_PORT",
    "LIVEKIT_SIP_PROMETHEUS_PORT",
  ]) {
    const ok = isPort(env[name]);
    record(checks, name, ok, { value: env[name] });
    if (!ok) issues.push(`LiveKit self-host invalid ${name}`);
  }

  const sipRange = portRange(
    env.LIVEKIT_SIP_RTP_PORT_START,
    env.LIVEKIT_SIP_RTP_PORT_END,
  );
  record(checks, "LIVEKIT_SIP_RTP_PORT_RANGE", sipRange.ok, sipRange);
  if (!sipRange.ok) issues.push("LiveKit self-host invalid LIVEKIT_SIP_RTP_PORT_RANGE");

  const rtcRange = portRange(env.LIVEKIT_RTC_PORT_START, env.LIVEKIT_RTC_PORT_END);
  const rangesDistinct = sipRange.ok && rtcRange.ok &&
    (sipRange.end < rtcRange.start || rtcRange.end < sipRange.start);
  record(checks, "LIVEKIT_SIP_RTC_RANGES_DISTINCT", rangesDistinct, {
    sipStart: sipRange.start,
    sipEnd: sipRange.end,
    rtcStart: rtcRange.start,
    rtcEnd: rtcRange.end,
  });
  if (!rangesDistinct) {
    issues.push("LiveKit self-host SIP and RTC UDP ranges must not overlap");
  }
}

export function toLiveKitSipConfig(env) {
  return {
    webhookUrl: env.LIVEKIT_WEBHOOK_URL,
    sipImage: env.LIVEKIT_SIP_IMAGE,
    sipOutboundTrunkId: env.LIVEKIT_SIP_OUTBOUND_TRUNK_ID,
    sipPort: Number(env.LIVEKIT_SIP_PORT),
    sipRtpPortStart: Number(env.LIVEKIT_SIP_RTP_PORT_START),
    sipRtpPortEnd: Number(env.LIVEKIT_SIP_RTP_PORT_END),
    sipHealthPort: Number(env.LIVEKIT_SIP_HEALTH_PORT),
    sipPrometheusPort: Number(env.LIVEKIT_SIP_PROMETHEUS_PORT),
    sipInboundEnabled: env.LIVEKIT_SIP_INBOUND_ENABLED === "true",
    sipInboundTrunkId: env.LIVEKIT_SIP_INBOUND_TRUNK_ID ?? "",
    sipInboundDedicatedTrunk:
      env.LIVEKIT_SIP_INBOUND_DEDICATED_TRUNK === "true",
    sipInboundDisplayNumber: env.LIVEKIT_SIP_INBOUND_DISPLAY_NUMBER ?? "",
  };
}

export function renderLiveKitSipYaml(config) {
  return [
    "log_level: info",
    `api_key: ${quote(config.apiKey)}`,
    `api_secret: ${quote(config.apiSecret)}`,
    `ws_url: ws://127.0.0.1:${config.httpPort}`,
    "redis:",
    "  address: 127.0.0.1:6379",
    `sip_port: ${config.sipPort}`,
    `rtp_port: ${config.sipRtpPortStart}-${config.sipRtpPortEnd}`,
    "use_external_ip: true",
    `health_port: ${config.sipHealthPort}`,
    `prometheus_port: ${config.sipPrometheusPort}`,
    "",
  ].join("\n");
}

export function renderLiveKitSipCompose(config) {
  return `
  sip:
    image: ${config.sipImage}
    command: ["--config", "/sipconfig.yaml"]
    network_mode: host
    restart: unless-stopped
    depends_on:
      - redis
    volumes:
      - ./sip.yaml:/sipconfig.yaml:ro
`;
}

export function renderLiveKitSipReleaseEnv(config) {
  return `PSTN_PROVIDER=livekit_sip
LIVEKIT_SIP_OUTBOUND_TRUNK_ID=${config.sipOutboundTrunkId}
LIVEKIT_WEBHOOK_URL=${config.webhookUrl}
LIVEKIT_SIP_RINGING_TIMEOUT_SECONDS=45
LIVEKIT_SIP_REQUEST_TIMEOUT_SECONDS=10
LIVEKIT_SIP_RECONCILIATION_GRACE_SECONDS=30
LIVEKIT_SIP_INBOUND_ENABLED=${config.sipInboundEnabled}
LIVEKIT_SIP_INBOUND_TRUNK_ID=${config.sipInboundTrunkId}
LIVEKIT_SIP_INBOUND_DEDICATED_TRUNK=${config.sipInboundDedicatedTrunk}
LIVEKIT_SIP_INBOUND_DISPLAY_NUMBER=${config.sipInboundDisplayNumber}
LIVEKIT_SIP_MEDIA_ROUTING_MODE=blocked_pending_media_isolation
PSTN_MAX_CALL_MINUTES=60
PSTN_RECORDING_DISCLOSURE_ENABLED=true
`;
}

function portRange(startValue, endValue) {
  const start = Number(startValue);
  const end = Number(endValue);
  return { start, end, ok: isPort(start) && isPort(end) && end - start >= 100 };
}

function isPublicHttpsUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" &&
      /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(parsed.hostname) &&
      !/example|localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function isImmutableImage(value) {
  return typeof value === "string" &&
    /^[a-z0-9._/-]+:[a-z0-9._-]+@sha256:[a-f0-9]{64}$/i.test(value);
}

function isPort(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 65535;
}

function quote(value) {
  return JSON.stringify(String(value));
}

function record(checks, name, ok, details) {
  checks.push({ name, status: ok ? "pass" : "fail", details });
}
