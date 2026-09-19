import {
  TencentTtsWireError,
  createTencentTtsWireUrl,
  streamTencentTtsPcm,
  validateTencentTtsWire,
} from "@translation/speech-quality";
import type { PublicModelAttemptEvent } from "@translation/contracts";
import { PublicSpeechError, type PublicSpeechOptions } from "./public-speech.js";

/**
 * Gateway-facing compatibility wrapper around the shared Tencent WebSocket
 * wire. The shared implementation is also used by the Call Link Worker so
 * signed URL and PCM protocol handling cannot drift between the two paths.
 */
export function validateTencentSpeech(options: PublicSpeechOptions) {
  try {
    validateTencentTtsWire(options);
  } catch (error) {
    throw publicError(error);
  }
}

/** Signed URLs are transport-local and must never be logged or persisted. */
export function tencentSpeechUrl(
  options: PublicSpeechOptions,
  credentials: { secretId?: string; secretKey?: string },
  wireId: string,
  now = Date.now(),
) {
  try {
    return createTencentTtsWireUrl(options, credentials, wireId, now);
  } catch (error) {
    throw publicError(error);
  }
}

export async function* tencentSpeechPcm(
  options: PublicSpeechOptions,
  text: string,
  credentials: { secretId?: string; secretKey?: string },
  signal: AbortSignal,
  markSent: () => void,
  metadata: NonNullable<PublicModelAttemptEvent["metadata"]>,
): AsyncIterable<Buffer> {
  try {
    yield* streamTencentTtsPcm(
      options,
      text,
      credentials,
      signal,
      markSent,
      metadata,
    );
  } catch (error) {
    throw publicError(error);
  }
}

function publicError(error: unknown) {
  if (error instanceof TencentTtsWireError) {
    return new PublicSpeechError(error.code, error.outcome);
  }
  return new PublicSpeechError("tencent_tts_transport_failed", "uncertain");
}
