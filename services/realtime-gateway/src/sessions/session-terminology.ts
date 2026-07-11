import type {
  RealtimeTokenClaims,
  TermbaseTermsResponse,
} from "@translation/contracts";
import type { RealtimeEnv } from "../config/env.js";

export async function fetchSessionTerminology(
  claims: RealtimeTokenClaims,
  env: RealtimeEnv,
  fetchFn: typeof fetch = fetch,
) {
  if (!claims.termbaseId) return [];
  const url = new URL("/internal/termbase/terms", normalizedBaseUrl(env.apiBaseUrl));
  url.searchParams.set("userId", claims.userId);
  url.searchParams.set("termbaseId", claims.termbaseId);
  url.searchParams.set("targetLanguage", claims.targetLanguage);
  if (claims.sourceLanguage === "zh" || claims.sourceLanguage === "en") {
    url.searchParams.set("sourceLanguage", claims.sourceLanguage);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.sessionSyncTimeoutMs);
  try {
    const response = await fetchFn(url, {
      method: "GET",
      headers: env.internalApiSecret
        ? { authorization: `Bearer ${env.internalApiSecret}` }
        : {},
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`termbase HTTP ${response.status}`);
    const body = await response.json() as TermbaseTermsResponse;
    return Array.isArray(body.terms) ? body.terms.slice(0, 20) : [];
  } finally {
    clearTimeout(timer);
  }
}

function normalizedBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/$/, "");
}
