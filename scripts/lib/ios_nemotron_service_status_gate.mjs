import { iosNemotronRequiredRuntimeContract as contract } from "./ios_nemotron_runtime_contract.mjs";

export async function checkServices(deviceReady) {
  if (usesLocalOnDeviceMvp()) {
    return {
      name: "api_gateway_services",
      status: "pass",
      message: "not required for local on-device MVP",
    };
  }
  const apiBaseUrl = process.env.API_BASE_URL ?? "";
  const realtimeBaseUrl = process.env.REALTIME_BASE_URL ?? "";
  const expectedEndpoint = realtimeBaseUrl
    ? realtimeWsEndpoint(realtimeBaseUrl)
    : "";
  if (!apiBaseUrl || !realtimeBaseUrl) {
    return {
      name: "api_gateway_services",
      status: deviceReady ? "fail" : "pending",
      message: deviceReady
        ? "API_BASE_URL and REALTIME_BASE_URL are required for real-device e2e"
        : "waiting for physical_iphone_readiness before API/Gateway e2e services are required",
    };
  }

  const errors = [];
  const expectedProvider = process.env.REALTIME_PROVIDER ??
    contract.gatewayProvider;
  const expectedAsrProvider = process.env.ASR_PROVIDER ??
    contract.gatewayAsrProvider;
  const expectedSessionEventSink = process.env.SESSION_EVENT_SINK ??
    contract.gatewaySessionEventSink;
  const api = await fetchJson(`${trimSlash(apiBaseUrl)}/health`);
  if (!api.ok) {
    errors.push(`API health failed: ${api.message}`);
  } else if (api.json?.realtimeWsEndpoint !== expectedEndpoint) {
    errors.push(
      `API realtimeWsEndpoint must be ${expectedEndpoint}; got ${api.json?.realtimeWsEndpoint ?? "missing"}`,
    );
  }

  const gateway = await fetchJson(`${trimSlash(realtimeBaseUrl)}/health`);
  if (!gateway.ok) {
    errors.push(`Gateway health failed: ${gateway.message}`);
  } else {
    if (gateway.json?.provider !== expectedProvider) {
      errors.push(
        `Gateway provider must be ${expectedProvider} for MVP e2e; got ${gateway.json?.provider ?? "missing"}`,
      );
    }
    if (gateway.json?.asrProvider !== expectedAsrProvider) {
      errors.push(
        `Gateway ASR provider must be ${expectedAsrProvider}; got ${gateway.json?.asrProvider ?? "missing"}`,
      );
    }
    if (
      process.env.SERVER_OWNED_HISTORY !== "false" &&
      gateway.json?.sessionEventSink !== expectedSessionEventSink
    ) {
      errors.push(
        `Gateway sessionEventSink must be ${expectedSessionEventSink} for MVP e2e`,
      );
    }
  }

  return {
    name: "api_gateway_services",
    status: errors.length === 0 ? "pass" : "fail",
    message: errors.length === 0
      ? serviceEvidenceMessage(apiBaseUrl, realtimeBaseUrl, expectedEndpoint, api.json, gateway.json)
      : errors.join("; "),
    details: {
      apiBaseUrl,
      realtimeBaseUrl,
      expectedRealtimeWsEndpoint: expectedEndpoint,
      expectedProvider,
      expectedAsrProvider,
      expectedSessionEventSink,
      apiHealth: api.ok ? api.json : null,
      gatewayHealth: gateway.ok ? gateway.json : null,
    },
  };
}

function serviceEvidenceMessage(
  apiBaseUrl,
  realtimeBaseUrl,
  expectedEndpoint,
  apiHealth,
  gatewayHealth,
) {
  const parts = [
    "configured service health checks passed",
    `api=${apiBaseUrl}`,
    `gateway=${realtimeBaseUrl}`,
    `ws=${apiHealth?.realtimeWsEndpoint ?? expectedEndpoint}`,
    `sink=${gatewayHealth?.sessionEventSink ?? "missing"}`,
  ];
  if (gatewayHealth?.provider) parts.push(`provider=${gatewayHealth.provider}`);
  if (gatewayHealth?.asrProvider) parts.push(`asr=${gatewayHealth.asrProvider}`);
  return parts.join("; ");
}

async function fetchJson(url) {
  try {
    const response = await fetch(url);
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : null;
    return response.ok
      ? { ok: true, json: parsed }
      : { ok: false, message: `${response.status} ${text}` };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

function trimSlash(value) {
  return value.replace(/\/+$/, "");
}

function realtimeWsEndpoint(realtimeBaseUrl) {
  const url = new URL(realtimeBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/realtime`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function usesLocalOnDeviceMvp() {
  return boolEnv("USE_LOCAL_SESSIONS", contract.useLocalSessions) &&
    boolEnv("USE_ON_DEVICE_TRANSLATION", contract.useOnDeviceTranslation);
}

function boolEnv(name, fallback) {
  const value = process.env[name];
  if (value == null || value === "") return Boolean(fallback);
  return value === "true";
}
