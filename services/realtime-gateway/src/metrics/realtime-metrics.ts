import pino from "pino";
import { logRedactionPaths, redactLogObject } from "@translation/contracts";

export const realtimeLogger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: logRedactionPaths,
    censor: "[REDACTED]",
  },
  formatters: {
    log: redactLogObject,
  },
});

export function loggableError(error: unknown) {
  return error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { name: "UnknownError", message: String(error) };
}
