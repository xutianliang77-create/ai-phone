import {
  liveKitSipControlTopic,
  parseLiveKitSipControl,
  sipDtmfCode,
  type LiveKitSipDtmfCommand,
} from "@translation/contracts";

interface SipControlRoom {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  localParticipant?: {
    publishDtmf(code: number, digit: string): Promise<void>;
  };
}

export interface SipControlStatusReporter {
  report(input: {
    callId: string;
    dialOperationId: string;
    controlOperationId: string;
    status: "succeeded" | "failed";
    errorClass?: string;
  }): Promise<void>;
}

export function attachSipControlHandler(input: {
  room: SipControlRoom;
  dataReceivedEvent: string | undefined;
  callId: string;
  reporter: SipControlStatusReporter;
  onError?: (error: unknown) => void;
}) {
  if (!input.dataReceivedEvent || !input.room.localParticipant?.publishDtmf) {
    throw new Error("RTC runtime does not support SIP DTMF publishing");
  }
  const handled = new Set<string>();
  let queue = Promise.resolve();
  input.room.on(input.dataReceivedEvent, (...args: unknown[]) => {
    const command = trustedCommand(args, input.callId);
    if (!command || handled.has(command.controlOperationId)) return;
    handled.add(command.controlOperationId);
    if (handled.size > 256) handled.delete(handled.values().next().value!);
    queue = queue.then(() => execute(input, command)).catch((error) => {
      input.onError?.(error);
    });
  });
}

function trustedCommand(args: unknown[], callId: string) {
  const [payload, participant, _kind, topic] = args;
  if (!(payload instanceof Uint8Array) || participant !== undefined ||
    topic !== liveKitSipControlTopic) return null;
  const command = parseLiveKitSipControl(payload);
  return command?.callId === callId ? command : null;
}

async function execute(
  input: Parameters<typeof attachSipControlHandler>[0],
  command: LiveKitSipDtmfCommand,
) {
  try {
    await input.room.localParticipant!.publishDtmf(
      sipDtmfCode(command.digit),
      command.digit,
    );
    await input.reporter.report({
      callId: input.callId,
      dialOperationId: command.dialOperationId,
      controlOperationId: command.controlOperationId,
      status: "succeeded",
    });
  } catch (error) {
    await input.reporter.report({
      callId: input.callId,
      dialOperationId: command.dialOperationId,
      controlOperationId: command.controlOperationId,
      status: "failed",
      errorClass: error instanceof Error ? error.name.slice(0, 80) : "dtmf_failed",
    }).catch((reportError) => input.onError?.(reportError));
    throw error;
  }
}
