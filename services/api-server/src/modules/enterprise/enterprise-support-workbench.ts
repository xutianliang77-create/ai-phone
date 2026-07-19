import type { EnterpriseSupportAgentRecentTurn } from "@translation/contracts";
import type {
  EnterpriseSupportAgentRunRecord,
  EnterpriseSupportAgentTurnRecord,
} from "./enterprise-support-agent.js";
import type { EnterpriseSupportAgentClaimRecord } from
  "./enterprise-support-agent-queue.js";
import type { EnterpriseSupportHighRiskHandoffRecord } from
  "./enterprise-support-high-risk-handoff.js";
import type { EnterpriseSupportSessionAggregate } from "./enterprise-support.js";
import type { EnterpriseSupportWriteAdapter } from
  "./enterprise-support-write-tool.js";

export interface EnterpriseSupportTranscriptSegment {
  segmentId: string;
  revision: number;
  sourceText: string;
  translatedText?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  speakerId?: string;
  speakerRole?: string;
  startMs?: number;
  endMs?: number;
  createdAt: string;
  updatedAt: string;
}

export type EnterpriseSupportAiSpeechFence = {
  status: "stopped" | "not_started" | "terminal";
  verifiedAt: string;
  runId?: string;
  runStatus?: EnterpriseSupportAgentRunRecord["status"];
};

export interface EnterpriseSupportWorkbenchSnapshot {
  generatedAt: string;
  aggregate: EnterpriseSupportSessionAggregate;
  claim: EnterpriseSupportAgentClaimRecord;
  aiSpeechFence: EnterpriseSupportAiSpeechFence;
  agentRun?: EnterpriseSupportAgentRunRecord;
  conversationContext: EnterpriseSupportAgentRecentTurn[];
  agentTurns: EnterpriseSupportAgentTurnRecord[];
  highRiskHandoffs: EnterpriseSupportHighRiskHandoffRecord[];
  transcriptSegments: EnterpriseSupportTranscriptSegment[];
  followupReadiness: ReturnType<EnterpriseSupportWriteAdapter["readiness"]>;
}
