export const liveKitSipControlTopic = "translation.sip-control.v1";

export interface LiveKitSipDtmfCommand {
  version: 1;
  type: "sip.dtmf";
  callId: string;
  dialOperationId: string;
  controlOperationId: string;
  digit: string;
}

export function encodeLiveKitSipControl(command: LiveKitSipDtmfCommand) {
  return new TextEncoder().encode(JSON.stringify(command));
}

export function parseLiveKitSipControl(
  payload: Uint8Array,
): LiveKitSipDtmfCommand | null {
  try {
    const value = JSON.parse(new TextDecoder().decode(payload)) as unknown;
    if (!value || typeof value !== "object") return null;
    const command = value as Record<string, unknown>;
    if (command.version !== 1 || command.type !== "sip.dtmf" ||
      !boundedIdentifier(command.callId, 128) ||
      !boundedIdentifier(command.dialOperationId, 128) ||
      !boundedIdentifier(command.controlOperationId, 128) ||
      !isSipDtmfDigit(command.digit)) return null;
    return command as unknown as LiveKitSipDtmfCommand;
  } catch {
    return null;
  }
}

export function isSipDtmfDigit(value: unknown): value is string {
  return typeof value === "string" && /^[0-9*#A-D]$/.test(value);
}

export function sipDtmfCode(digit: string) {
  if (/^[0-9]$/.test(digit)) return Number(digit);
  return digit === "*" ? 10 : digit === "#" ? 11 : digit.charCodeAt(0) - 53;
}

function boundedIdentifier(value: unknown, maximum: number) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum &&
    /^[A-Za-z0-9:_-]+$/.test(value);
}
