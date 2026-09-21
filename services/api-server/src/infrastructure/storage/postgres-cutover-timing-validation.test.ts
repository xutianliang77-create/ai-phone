import { describe, expect, it, vi } from "vitest";
import { validateFractionalTranscriptTiming } from "./postgres-cutover-timing-validation.js";

function pool(kind = "valid") {
  return { query: vi.fn(async (sql: string) => {
    if (sql.includes("information_schema.columns")) return { rows:
      ["start_ms", "end_ms", "latency_ms"].map(column_name => ({ column_name,
        data_type: kind === "integer_column" ? "bigint" : "numeric" })) };
    if (sql.includes("pg_get_functiondef")) return { rows: [{ definition:
      kind === "integer_conversion" ? "::bigint" : [
        "NULLIF(segment#>>'{timing,startMs}', '')::numeric",
        "NULLIF(segment#>>'{timing,endMs}', '')::numeric",
        "NULLIF(segment->>'latencyMs', '')::numeric",
      ].join("\n") }] };
    if (sql.includes("AS timing_mismatches")) return { rows: [{
      timing_mismatches: kind === "mismatched_data" ? "1" : "0",
    }] };
    throw Error("Unexpected validation query");
  }) } as never;
}

describe("fractional transcript timing upgrade evidence", () => {
  it("requires widened columns, matching conversions and exact existing values", async () => {
    await expect(validateFractionalTranscriptTiming(pool())).resolves.toEqual({
      migration: "045_fractional_transcript_timing",
      details: { numericColumns: true, fractionalProjection: true, timingMismatches: 0 },
    });
  });
  it.each(["integer_column", "integer_conversion", "mismatched_data"])(
    "does not sign readiness for %s", async kind => {
      await expect(validateFractionalTranscriptTiming(pool(kind))).rejects.toThrow("validation failed");
    },
  );
});
