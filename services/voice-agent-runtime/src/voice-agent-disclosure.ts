interface DisclosureSession {
  say(text: string, options: {
    allowInterruptions: boolean;
    addToChatCtx: boolean;
  }): { waitForPlayout(): Promise<unknown> };
  resumeReplyAuthorization(): void;
  generateReply(options: { instructions: string }): unknown;
}

interface DisclosureInput {
  session: DisclosureSession;
  disclosureText: string;
  replyInstructions: string;
  closed: Promise<void>;
  isClosed: () => boolean;
  report: (event: "disclosure_started" | "disclosure_completed") =>
    Promise<unknown>;
}

export async function playVoiceAgentDisclosure(input: Omit<
  DisclosureInput,
  "replyInstructions"
>) {
  await input.report("disclosure_started");
  if (input.isClosed()) return false;
  const playout = input.session.say(input.disclosureText, {
    allowInterruptions: false,
    addToChatCtx: true,
  }).waitForPlayout();
  const outcome = await Promise.race([
    playout.then(() => "played" as const),
    input.closed.then(() => "closed" as const),
  ]);
  if (outcome === "closed" || input.isClosed()) return false;
  await input.report("disclosure_completed");
  return !input.isClosed();
}

export async function discloseAndGenerateReply(input: DisclosureInput) {
  if (!await playVoiceAgentDisclosure(input)) return false;
  input.session.resumeReplyAuthorization();
  if (input.isClosed()) return false;
  try {
    input.session.generateReply({ instructions: input.replyInstructions });
  } catch (error) {
    if (input.isClosed()) return false;
    throw error;
  }
  return true;
}

export function voiceAgentReplyInstructions(input: {
  recordingConsent?: { promptText: string };
}) {
  return input.recordingConsent
    ? `Before discussing the objective, ask exactly: "${
        input.recordingConsent.promptText
      }" Wait for an explicit yes or no. Call record_recording_consent with the exact transcribed answer. A refusal must be recorded as revoked and the call may continue without recording. If consent is later withdrawn, call the tool again immediately.`
    : "Continue with the approved objective now. Stay within the approved script and tools.";
}
