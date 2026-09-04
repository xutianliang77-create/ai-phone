export interface AsrTokenTimingDto {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
  characterStart?: number;
  characterEnd?: number;
}

export function isAsrTokenTiming(value: unknown): value is AsrTokenTimingDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<AsrTokenTimingDto>;
  const hasCharacterRange = item.characterStart !== undefined ||
    item.characterEnd !== undefined;
  return typeof item.text === "string" &&
    item.text.trim().length > 0 && item.text.length <= 200 &&
    finiteNonNegative(item.startMs) &&
    finiteNonNegative(item.endMs) && item.endMs >= item.startMs &&
    (item.confidence === undefined ||
      finiteNonNegative(item.confidence) && item.confidence <= 1) &&
    (!hasCharacterRange ||
      Number.isInteger(item.characterStart) && item.characterStart! >= 0 &&
      Number.isInteger(item.characterEnd) &&
      item.characterEnd! >= item.characterStart!);
}

export function isAsrTokenTimings(
  value: unknown,
): value is AsrTokenTimingDto[] {
  if (!Array.isArray(value) || value.length > 2_048) return false;
  let previousStartMs = -1;
  let previousCharacterStart = -1;
  for (const item of value) {
    if (!isAsrTokenTiming(item) || item.startMs < previousStartMs) return false;
    if (
      item.characterStart !== undefined &&
      item.characterStart < previousCharacterStart
    ) return false;
    previousStartMs = item.startMs;
    if (item.characterStart !== undefined) {
      previousCharacterStart = item.characterStart;
    }
  }
  return true;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
