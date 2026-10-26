import type { RealtimeSession } from "../sessions/realtime-session.js";
import type { RealtimeProvider } from "../providers/realtime-provider.js";
import type { SessionEventSink } from "../sessions/session-event-sink.js";
import { getSession, transitionStatus, sessionBillableSeconds, deleteSession } from "../sessions/session-manager.js";
import { signGatewayStopReceipt } from "@translation/platform-security";

export async function recordProviderStartupFailure(options: {
  session: RealtimeSession; generation: number; provider: RealtimeProvider | undefined;
  providerDispatched: boolean; admissionConfirmed: boolean;
  sessionEventSink: Pick<SessionEventSink, "record">; secret: string;
}) {
  const { session, generation, provider, providerDispatched, admissionConfirmed, sessionEventSink } = options;
      const current = getSession(session.id);
      if (current === session && current.connectionGeneration === generation) {
        let closed = admissionConfirmed && !providerDispatched;
        if (session.formalRelease && providerDispatched) {
          try { await provider!.closeSession(session.id); closed = admissionConfirmed; } catch { closed = false; }
        }
        if (session.formalRelease) session.providerCloseConfirmed = closed;
        transitionStatus(session.id, "failed");
        if (!session.formalRelease || closed) {
          const seconds = sessionBillableSeconds(session);
          if (session.formalRelease) session.gatewayReceipt = signGatewayStopReceipt({
            sessionId: session.id, userId: session.userId, billableSeconds: seconds,
            providerClosed: true, issuedAt: Date.now(),
          }, options.secret);
          await sessionEventSink.record({
          type: "session.ended",
          sessionId: session.id,
          reason: "connection_error",
          billableSeconds: seconds,
          ...(session.gatewayReceipt ? { gatewayReceipt: session.gatewayReceipt } : {}),
        }).catch(() => undefined);
        }
        deleteSession(session.id, session);
      }
}
