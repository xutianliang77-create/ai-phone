export async function syncVoiceReferenceAudio(
  referenceAudioId: string,
  audio: Buffer,
) {
  const endpoint = process.env.TTS_VOICE_REFERENCE_UPLOAD_ENDPOINT?.trim();
  if (!endpoint) return { ok: true as const, skipped: true as const };

  const url = `${endpoint.replace(/\/+$/, "")}/${encodeURIComponent(referenceAudioId)}`;
  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...(process.env.TTS_HTTP_API_KEY
          ? { authorization: `Bearer ${process.env.TTS_HTTP_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({ audioBase64: audio.toString("base64") }),
    });
    if (!response.ok) {
      return {
        ok: false as const,
        message: `TTS voice reference upload returned HTTP ${response.status}`,
      };
    }
    return { ok: true as const, skipped: false as const };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
