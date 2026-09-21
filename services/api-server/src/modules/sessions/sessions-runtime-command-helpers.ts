import {
  repositoryCommandId
} from "../../infrastructure/storage/repository-command-identity.js";
import type { SessionRecord } from "./session-record.js";

export function resolveResult<T>(value: T | ((saved: SessionRecord) => T), saved: SessionRecord) {
  return typeof value === "function"
    ? (value as (session: SessionRecord) => T)(saved) : value;
}


export function commandId(sessionId: string, operation: string, version: number, hash: string) {
  return repositoryCommandId({
    aggregateId: sessionId,
    operation,
    version,
    requestHash: hash,
  });
}


export interface MutationPlan<T> {
  next: SessionRecord | null;
  result: T | ((saved: SessionRecord) => T);
}
