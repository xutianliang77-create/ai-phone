export async function samplePlatformSystemMetrics(options) {
  const [utilization, oom, queue] = await Promise.all([
    queryScalar(options, options.queries.utilization),
    queryScalar(options, options.queries.oom),
    queryScalar(options, options.queries.unboundedQueue),
  ]);
  if (utilization.value < 0 || utilization.value > 1) {
    throw new Error("Prometheus utilization query must return a ratio from 0 to 1");
  }
  if (!Number.isInteger(oom.value) || oom.value < 0) {
    throw new Error("Prometheus OOM query must return a non-negative integer");
  }
  if (queue.value < 0) {
    throw new Error("Prometheus unbounded queue query must return a non-negative value");
  }
  return {
    schemaVersion: 1,
    source: "prometheus",
    observedUtilization: utilization.value,
    oomCount: oom.value,
    unboundedQueueObserved: queue.value > 0,
    sampledAt: new Date(
      Math.max(utilization.timestamp, oom.timestamp, queue.timestamp) * 1000,
    ).toISOString(),
  };
}

async function queryScalar(options, query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const url = new URL("/api/v1/query", options.prometheusUrl);
  url.searchParams.set("query", query);
  try {
    const response = await (options.fetchFn ?? fetch)(url, {
      redirect: "error",
      headers: options.token
        ? { authorization: `Bearer ${options.token}` }
        : {},
      signal: controller.signal,
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok || body?.status !== "success") {
      throw new Error(`Prometheus query failed with HTTP ${response.status}`);
    }
    const samples = samplesFrom(body.data);
    if (samples.length !== 1) {
      throw new Error("Prometheus acceptance queries must each return exactly one scalar");
    }
    const [timestamp, raw] = samples[0];
    const value = Number(raw);
    if (!Number.isFinite(timestamp) || !Number.isFinite(value)) {
      throw new Error("Prometheus query returned a non-finite sample");
    }
    return { timestamp, value };
  } finally {
    clearTimeout(timer);
  }
}

function samplesFrom(data) {
  if (data?.resultType === "scalar" && Array.isArray(data.result)) {
    return [data.result];
  }
  if (data?.resultType === "vector" && Array.isArray(data.result)) {
    return data.result.map((item) => item.value);
  }
  return [];
}
