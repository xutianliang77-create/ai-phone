import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import {
  recoverPendingVoiceIdentityDeletions as recoverLegacy,
} from "./voice-identity-deletion-recovery.js";
import {
  listPendingVoiceIdentityDeletions,
  removeStoredEmbedding,
} from "./voice-identities-runtime.service.js";

export async function recoverPendingVoiceIdentityDeletions() {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return recoverLegacy();
  const pending = await listPendingVoiceIdentityDeletions();
  let deletedCount = 0;
  for (const identity of pending) {
    try {
      if (await removeStoredEmbedding(identity.userId, identity)) deletedCount += 1;
    } catch {
      // Preserve the provider reference for the next idempotent sweep.
    }
  }
  return { inspectedCount: pending.length, deletedCount };
}

export function startVoiceIdentityDeletionRecovery(options: {
  intervalMs: number;
  onError?: (error: unknown) => void;
}) {
  const timer = setInterval(() => {
    void recoverPendingVoiceIdentityDeletions().catch(options.onError);
  }, options.intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
