interface VoiceAgentMediaSession {
  pauseReplyAuthorization(): void;
  resumeReplyAuthorization(): void;
  interrupt(input: { force: true }): { await: Promise<unknown> } | undefined;
  generateReply(input: { instructions: string }): unknown;
  input: { setAudioEnabled(enabled: boolean): void };
  output: {
    setAudioEnabled(enabled: boolean): void;
    audio?: { clearBuffer(): void } | null;
  };
}

export async function pauseVoiceAgentMedia(session: VoiceAgentMediaSession | undefined) {
  session?.pauseReplyAuthorization();
  const interrupted = session?.interrupt({ force: true });
  if (interrupted) await interrupted.await.catch(() => {});
  session?.output.audio?.clearBuffer();
  session?.output.setAudioEnabled(false);
  session?.input.setAudioEnabled(false);
}

export function resumeVoiceAgentMedia(
  session: VoiceAgentMediaSession | undefined,
  options: { returningFromTakeover: boolean },
) {
  session?.input.setAudioEnabled(true);
  session?.output.setAudioEnabled(true);
  session?.resumeReplyAuthorization();
  if (options.returningFromTakeover) {
    session?.generateReply({
      instructions:
        "The human declined takeover. Resume the approved task without repeating completed steps.",
    });
  }
}
