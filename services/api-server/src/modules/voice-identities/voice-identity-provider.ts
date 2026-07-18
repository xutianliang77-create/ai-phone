interface MatchResponse {
  embeddingRef?: string;
  confidence: number;
}

export async function enrollVoiceIdentity(input: {
  identityId: string;
  audioBase64: string;
}) {
  const response = await request(
    `/voice-identities/${encodeURIComponent(input.identityId)}/enroll`,
    { method: "POST", body: JSON.stringify({ audioBase64: input.audioBase64 }) },
  );
  const body = await response.json() as { embeddingRef?: unknown };
  if (typeof body.embeddingRef !== "string" || !body.embeddingRef) {
    throw new Error("Speaker service returned no embedding reference");
  }
  return body.embeddingRef;
}

export async function matchVoiceIdentity(input: {
  audioBase64: string;
  candidateRefs: string[];
  threshold: number;
}): Promise<MatchResponse> {
  const response = await request("/voice-identities/match", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return await response.json() as MatchResponse;
}

export async function deleteVoiceIdentityEmbedding(embeddingRef: string) {
  await request(`/voice-identities/${encodeURIComponent(embeddingRef)}`, {
    method: "DELETE",
  });
}

function request(path: string, init: RequestInit) {
  const baseUrl = process.env.VOICE_IDENTITY_HTTP_BASE_URL?.replace(/\/+$/, "");
  if (!baseUrl) throw new Error("Voice identity provider is not configured");
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(process.env.SPEAKER_HTTP_API_KEY
        ? { authorization: `Bearer ${process.env.SPEAKER_HTTP_API_KEY}` }
        : {}),
    },
    signal: AbortSignal.timeout(Number(process.env.VOICE_IDENTITY_HTTP_TIMEOUT_MS ?? 30000)),
  }).then((response) => {
    if (!response.ok) throw new Error(`Voice identity provider HTTP ${response.status}`);
    return response;
  });
}
