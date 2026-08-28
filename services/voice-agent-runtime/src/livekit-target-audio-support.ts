export function voiceAgentTargetTrackName(targetParticipantIdentity: string) {
  if (!targetParticipantIdentity ||
    Buffer.byteLength(targetParticipantIdentity) > 320) {
    throw new Error("Invalid Voice Agent target participant identity");
  }
  return `translation-tts-guest-24000.${
    Buffer.from(targetParticipantIdentity).toString("base64url")
  }`;
}

export async function waitForTargetAudioSubscription(
  subscribed: Promise<unknown>,
  signal: AbortSignal,
) {
  if (signal.aborted) throw targetAudioAbortError();
  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(targetAudioAbortError());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([subscribed, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function targetAudioAbortError() {
  const error = new Error("Target audio output start aborted");
  error.name = "AbortError";
  return error;
}
