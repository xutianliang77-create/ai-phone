import pino from "pino";
import { logRedactionPaths, redactLogObject } from "@translation/contracts";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: logRedactionPaths,
    censor: "[REDACTED]",
  },
  formatters: {
    log: redactLogObject,
  },
});
