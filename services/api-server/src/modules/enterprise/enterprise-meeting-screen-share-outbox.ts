import type { EnterpriseOutboxEventRecord } from
  "./enterprise-event-record.js";
import type { EnterpriseMeetingScreenShareProvider } from
  "./enterprise-meeting-screen-share-provider.js";
import { enterpriseMeetingScreenShareRoomName } from
  "./enterprise-meeting-screen-share.js";
import type { EnterpriseOutboxPublisher } from
  "./enterprise-outbox-processor.js";

export function createEnterpriseMeetingScreenShareOutboxPublisher(input: {
  provider: EnterpriseMeetingScreenShareProvider;
  fallback: EnterpriseOutboxPublisher;
  rtcUrl: string;
}): EnterpriseOutboxPublisher {
  return {
    publish(event) {
      if (event.eventType !== "meeting.screen_share.revoke.requested") {
        return input.fallback.publish(event);
      }
      return revoke(input, event);
    },
  };
}

async function revoke(
  input: Parameters<typeof createEnterpriseMeetingScreenShareOutboxPublisher>[0],
  event: Readonly<EnterpriseOutboxEventRecord>,
) {
  const payload = revocationPayload(event.payload);
  if (!payload || !input.rtcUrl) {
    return { status: "retry" as const, reason: "screen_share_revoke_not_ready" };
  }
  const result = await input.provider.revoke({
    rtcUrl: input.rtcUrl,
    roomName: enterpriseMeetingScreenShareRoomName(payload.communicationSessionId),
    publisherIdentity: payload.publisherIdentity,
  });
  return result.status === "completed"
    ? { status: "completed" as const }
    : { status: "retry" as const, reason: result.reasonCode };
}

function revocationPayload(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const communicationSessionId = item.communicationSessionId;
  const publisherIdentity = item.publisherIdentity;
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-" +
    "[89ab][0-9a-f]{3}-[0-9a-f]{12}";
  return typeof communicationSessionId === "string" &&
    new RegExp(`^${uuid}$`, "i").test(communicationSessionId) &&
    typeof publisherIdentity === "string" &&
    new RegExp(`^ent-share:${uuid}:g[1-9][0-9]*$`, "i")
      .test(publisherIdentity)
    ? { communicationSessionId, publisherIdentity } : null;
}
