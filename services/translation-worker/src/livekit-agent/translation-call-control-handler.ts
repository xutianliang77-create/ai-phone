import {
  parseTranslationCallControl,
  translationCallControlTopic,
  type TranslationCallControlCommand,
} from "@translation/contracts";
import type { CallTranslationControlPipeline } from "../worker/types.js";

interface TranslationControlRoom {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface TranslationControlStatusReporter {
  report(input: {
    callId: string;
    dialOperationId: string;
    controlOperationId: string;
    dispatchGeneration: number;
    controlGeneration: number;
    status: "prepared" | "succeeded" | "failed";
    errorClass?: string;
  }): Promise<void>;
}

interface ControlReport {
  fingerprint: string;
  status: "prepared" | "succeeded" | "failed";
  errorClass?: string;
}

interface ControlOutcome extends ControlReport {
  status: "succeeded" | "failed";
}

export function attachTranslationCallControlHandler(input: {
  room: TranslationControlRoom;
  dataReceivedEvent: string | undefined;
  callId: string;
  dispatchGeneration: number;
  initialControlGeneration: number;
  initialUplinkPaused: boolean;
  pipeline: CallTranslationControlPipeline;
  reporter: TranslationControlStatusReporter;
  nowMs?: () => number;
  onError?: (error: unknown) => void;
}) {
  if (!input.dataReceivedEvent) {
    throw new Error("RTC runtime does not support translation control data");
  }
  const runtime = new TranslationCallControlRuntime(input);
  input.room.on(input.dataReceivedEvent, (...args: unknown[]) => {
    const command = trustedCommand(args, input);
    if (command) runtime.receive(command);
  });
  return runtime;
}

export class TranslationCallControlRuntime {
  private controlGeneration: number;
  private uplinkPaused: boolean;
  private queue = Promise.resolve();
  private readonly fingerprints = new Map<string, string>();
  private readonly outcomes = new Map<string, ControlOutcome>();
  private readonly nowMs: () => number;

  constructor(private readonly input: Parameters<
    typeof attachTranslationCallControlHandler
  >[0]) {
    this.controlGeneration = input.initialControlGeneration;
    this.uplinkPaused = input.initialUplinkPaused;
    this.nowMs = input.nowMs ?? Date.now;
  }

  receive(command: TranslationCallControlCommand) {
    const fingerprint = commandFingerprint(command);
    const existing = this.fingerprints.get(command.controlOperationId);
    if (existing && existing !== fingerprint) {
      this.input.onError?.(new Error("Translation control payload conflict"));
      return;
    }
    if (!existing) {
      if (this.fingerprints.size >= 1024) {
        this.input.onError?.(new Error("Translation control inbox is full"));
        return;
      }
      this.fingerprints.set(command.controlOperationId, fingerprint);
      this.enqueue(() => this.execute(command, fingerprint));
      return;
    }
    this.enqueue(async () => {
      const outcome = this.outcomes.get(command.controlOperationId);
      if (outcome) await this.report(command, outcome);
      else this.input.onError?.(
        new Error("Translation control replay outcome was evicted"),
      );
    });
  }

  snapshot() {
    return {
      controlGeneration: this.controlGeneration,
      uplinkPaused: this.uplinkPaused,
    };
  }

  private enqueue(operation: () => Promise<void>) {
    this.queue = this.queue.then(operation).catch((error) => {
      this.input.onError?.(error);
    });
  }

  private async execute(
    command: TranslationCallControlCommand,
    fingerprint: string,
  ) {
    const invalid = this.validate(command);
    if (invalid) {
      await this.finish(command, { fingerprint, status: "failed",
        errorClass: invalid });
      return;
    }
    if (command.type === "translation.type_to_speak") {
      await this.executeTypedText(command, fingerprint);
      return;
    }
    await this.executeUplinkControl(command, fingerprint);
  }

  private validate(command: TranslationCallControlCommand) {
    const now = this.nowMs();
    if (Date.parse(command.expiresAt) <= now) return "control_expired";
    if (Date.parse(command.issuedAt) > now + 5_000) return "control_not_yet_valid";
    if (command.type === "translation.type_to_speak") {
      if (command.controlGeneration !== this.controlGeneration) {
        return "stale_control_generation";
      }
      return this.uplinkPaused ? "translation_uplink_paused" : null;
    }
    if (command.controlGeneration <= this.controlGeneration) {
      return "stale_control_generation";
    }
    return command.controlGeneration > this.controlGeneration + 1
      ? "control_generation_gap" : null;
  }

  private async executeTypedText(
    command: Extract<TranslationCallControlCommand, {
      type: "translation.type_to_speak";
    }>,
    fingerprint: string,
  ) {
    let outcome: ControlOutcome;
    try {
      await this.report(command, { fingerprint, status: "prepared" });
      await this.input.pipeline.processTypedText({
        callId: command.callId,
        controlOperationId: command.controlOperationId,
        text: command.text,
        sourceLanguage: command.sourceLanguage,
        targetLanguage: command.targetLanguage,
      });
      outcome = { fingerprint, status: "succeeded" };
    } catch (error) {
      outcome = { fingerprint, status: "failed",
        errorClass: errorClass(error, "type_to_speak_failed") };
    }
    await this.finish(command, outcome);
  }

  private async executeUplinkControl(
    command: Extract<TranslationCallControlCommand, {
      type: "translation.uplink_pause";
    }>,
    fingerprint: string,
  ) {
    if (!command.paused) {
      let outcome: ControlOutcome;
      try {
        await this.report(command, { fingerprint, status: "prepared" });
        await this.input.pipeline.setTranslatedUplinkPaused(
          command.callId,
          false,
        );
        this.uplinkPaused = false;
        outcome = { fingerprint, status: "succeeded" };
      } catch (error) {
        await this.input.pipeline.setTranslatedUplinkPaused(
          command.callId,
          true,
        ).catch(() => undefined);
        this.uplinkPaused = true;
        outcome = { fingerprint, status: "failed",
          errorClass: errorClass(error, "translation_resume_failed") };
      }
      this.controlGeneration = command.controlGeneration;
      await this.finish(command, outcome);
      return;
    }
    let outcome: ControlOutcome;
    try {
      const result = await this.input.pipeline.setTranslatedUplinkPaused(
        command.callId,
        true,
      );
      if (result.hadActivePlayback &&
        (!result.interruption?.supported || !result.interruption.cleared)) {
        throw new Error("Active translated audio could not be cleared");
      }
      this.controlGeneration = command.controlGeneration;
      this.uplinkPaused = true;
      outcome = { fingerprint, status: "succeeded" };
    } catch (error) {
      this.uplinkPaused = true;
      outcome = { fingerprint, status: "failed",
        errorClass: errorClass(error, "translation_pause_failed") };
    }
    this.controlGeneration = command.controlGeneration;
    await this.finish(command, outcome);
  }

  private async finish(
    command: TranslationCallControlCommand,
    outcome: ControlOutcome,
  ) {
    this.remember(command, outcome);
    await this.report(command, outcome);
  }

  private remember(
    command: TranslationCallControlCommand,
    outcome: ControlOutcome,
  ) {
    this.outcomes.set(command.controlOperationId, outcome);
    while (this.outcomes.size > 256) {
      const operationId = this.outcomes.keys().next().value as string;
      this.outcomes.delete(operationId);
    }
  }

  private report(
    command: TranslationCallControlCommand,
    outcome: ControlReport,
  ) {
    return this.input.reporter.report({
      callId: command.callId,
      dialOperationId: command.dialOperationId,
      controlOperationId: command.controlOperationId,
      dispatchGeneration: command.dispatchGeneration,
      controlGeneration: command.controlGeneration,
      status: outcome.status,
      ...(outcome.errorClass ? { errorClass: outcome.errorClass } : {}),
    });
  }
}

function trustedCommand(
  args: unknown[],
  input: { callId: string; dispatchGeneration: number },
) {
  const [payload, participant, _kind, topic] = args;
  if (!(payload instanceof Uint8Array) || participant !== undefined ||
    topic !== translationCallControlTopic) return null;
  const command = parseTranslationCallControl(payload);
  return command?.callId === input.callId &&
      command.dispatchGeneration === input.dispatchGeneration
    ? command : null;
}

function commandFingerprint(command: TranslationCallControlCommand) {
  return JSON.stringify(command);
}

function errorClass(error: unknown, fallback: string) {
  return error instanceof Error && error.name !== "Error" &&
      /^[A-Za-z0-9._:-]{1,80}$/.test(error.name)
    ? error.name : fallback;
}
