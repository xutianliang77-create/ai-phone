import type { RealtimeEnv } from "../config/env.js";
import {
  mergeTerminologyWithDomainPacks,
} from "../domain/domain-lexicon.js";
import { realtimeLogger } from "../metrics/realtime-metrics.js";
import type { RealtimeSession } from "./realtime-session.js";
import { fetchSessionTerminology } from "./session-terminology.js";

export async function loadTerminologyForSession(
  session: RealtimeSession,
  env: RealtimeEnv,
) {
  const packs = domainLexiconPacksForSession(session, env);
  try {
    return mergeTerminologyWithDomainPacks(
      await fetchSessionTerminology(session.claims, env),
      packs,
    );
  } catch (error) {
    realtimeLogger.warn({
      error,
      sessionId: session.id,
      termbaseId: session.claims.termbaseId,
    }, "Realtime terminology fetch failed");
    return mergeTerminologyWithDomainPacks([], packs);
  }
}

export function domainLexiconPacksForSession(
  session: RealtimeSession,
  env: RealtimeEnv,
) {
  return session.claims.domainLexiconPacks ?? env.domainLexiconPacks;
}
