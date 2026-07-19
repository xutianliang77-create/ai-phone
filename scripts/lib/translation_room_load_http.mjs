export async function requestLoadJson(options, url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.requestTimeoutMs);
  const aborted = () => controller.abort(options.signal.reason);
  options.signal?.addEventListener("abort", aborted, { once: true });
  try {
    const response = await (options.fetchFn ?? fetch)(url, {
      method: init.method ?? "GET",
      redirect: "error",
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.account && options.accountToken
          ? { authorization: `Bearer ${options.accountToken}` }
          : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) throw new LoadHttpError(response.status, body, url);
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", aborted);
  }
}

export class LoadHttpError extends Error {
  constructor(status, body, url) {
    const code = body?.error?.code ?? "http_error";
    super(body?.error?.message ?? `${url} returned HTTP ${status}`);
    this.status = status;
    this.code = code;
  }
}

export function admissionRejectionAttestation(error, observedDurationMs) {
  if (!(error instanceof LoadHttpError) || !isCapacityResponse(error)) return null;
  return {
    schemaVersion: 1,
    status: "rejected",
    environment: "staging",
    realProviderTraffic: true,
    observedDurationMs,
    admissionEvidence: [`http:${error.status}:${error.code}`],
  };
}

function isCapacityResponse(error) {
  return error.status === 429 ||
    (error.status === 503 && /capacity|worker_unavailable|limit/.test(error.code));
}
