import {
  getStoreSnapshot,
  persistStoreSnapshot,
  runStoreTransaction,
} from "../../infrastructure/storage/json-store.js";
import { deleteVoiceIdentityEmbedding } from "./voice-identity-provider.js";

export async function recoverPendingVoiceIdentityDeletions() {
  const pending = getStoreSnapshot().voiceIdentities.filter((identity) =>
    identity.status !== "ready" && identity.embeddingRef
  );
  let deletedCount = 0;
  for (const identity of pending) {
    const embeddingRef = identity.embeddingRef!;
    try {
      await deleteVoiceIdentityEmbedding(embeddingRef);
      runStoreTransaction(() => {
        const current = getStoreSnapshot().voiceIdentities.find((item) =>
          item.id === identity.id && item.embeddingRef === embeddingRef
        );
        if (!current || current.status === "ready") return;
        delete current.embeddingRef;
        current.updatedAt = new Date().toISOString();
        persistStoreSnapshot();
        deletedCount += 1;
      });
    } catch {
      // Keep the hidden provider reference so the next sweep can retry.
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
