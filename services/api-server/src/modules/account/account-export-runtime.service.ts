import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import { listAgentCallDrafts } from
  "../agent-calls/agent-calls-runtime.repository.js";
import { getBillingLedger } from "../billing/billing-runtime.service.js";
import { listSessions } from "../sessions/sessions-runtime.repository.js";
import type { TermbaseTermRecord } from "../terms/term-record.js";
import { getUsageBalance } from "../usage/usage-hold-runtime.service.js";
import type { VoiceProfileRecord } from "../voice-profiles/voice-profile-record.js";
import type { AccountRecord } from "./account-record.js";
import { listAccountConsents } from "./account-consent-runtime.service.js";
import { toAccountDto } from "./account-runtime.service.js";
import { exportAccountData as exportLegacy } from "./account.service.js";

export async function exportAccountData(account: AccountRecord) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return exportLegacy(account);
  const [usage, sessions, billing, consents, agentCalls, terms, voiceProfiles] =
    await Promise.all([
      getUsageBalance(account.id),
      listSessions(account.id),
      getBillingLedger(account.id),
      listAccountConsents(account),
      listAgentCallDrafts(account.id),
      runtime.postgres.productRecords.query<TermbaseTermRecord>({
        namespace: "termbaseTerms", ownerId: account.id, limit: 500,
      }),
      runtime.postgres.productRecords.query<VoiceProfileRecord>({
        namespace: "voiceProfiles", ownerId: account.id, limit: 500,
      }),
    ]);
  return {
    exportedAt: new Date().toISOString(),
    account: toAccountDto(account),
    usage,
    sessions: sessions.map((session) => ({
      id: session.id,
      mode: session.mode,
      status: session.status,
      consumedSeconds: session.consumedSeconds,
      createdAt: session.createdAt,
      endedAt: session.endedAt,
      segmentCount: session.segments.length,
    })),
    billingLedger: billing.ledger,
    termbaseTerms: terms,
    consents,
    agentCalls: agentCalls.map((draft) => ({
      id: draft.id,
      scenario: draft.scenario,
      status: draft.status,
      riskLevel: draft.riskLevel,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    })),
    voiceProfiles: voiceProfiles.map((profile) => ({
      id: profile.id,
      displayName: profile.displayName,
      status: profile.status,
      voiceMode: profile.voiceMode,
      consentVersion: profile.consentVersion,
      consentAcceptedAt: profile.consentAcceptedAt,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      deletedAt: profile.deletedAt,
    })),
  };
}
