import type {
  EnterpriseMeetingScreenOcrLayoutDto,
  EnterpriseMeetingScreenOcrResponse,
} from "@translation/contracts";
import type { EnterpriseMeetingScreenOcrView } from
  "./enterprise-meeting-screen-ocr.js";

export function screenOcrResponse(
  view: EnterpriseMeetingScreenOcrView,
  replayed = false,
): EnterpriseMeetingScreenOcrResponse {
  return {
    run: view.run ? {
      id: view.run.id, meetingId: view.run.meetingId,
      shareId: view.run.shareId, shareGeneration: view.run.shareGeneration,
      targetLanguage: view.run.targetLanguage, status: view.run.status,
      ...(view.run.reasonCode ? { reasonCode: view.run.reasonCode } : {}),
      ...(view.run.providerFingerprint
        ? { providerFingerprint: view.run.providerFingerprint } : {}),
      createdAt: view.run.createdAt, updatedAt: view.run.updatedAt,
      ...(view.run.endedAt ? { endedAt: view.run.endedAt } : {}),
      version: view.run.version,
    } : null,
    subscription: view.subscription ? {
      id: view.subscription.id, meetingId: view.subscription.meetingId,
      shareId: view.subscription.shareId,
      shareGeneration: view.subscription.shareGeneration,
      runId: view.subscription.runId,
      participantId: view.subscription.participantId,
      targetLanguage: view.subscription.targetLanguage,
      displayMode: view.subscription.displayMode,
      enabled: view.subscription.enabled,
      createdAt: view.subscription.createdAt,
      updatedAt: view.subscription.updatedAt,
      version: view.subscription.version,
    } : null,
    layout: view.layout && view.run
      ? screenOcrLayout(view.layout, view.run.shareGeneration) : null,
    ...(replayed ? { replayed: true as const } : {}),
  };
}

export function screenOcrLayout(
  layout: NonNullable<EnterpriseMeetingScreenOcrView["layout"]>,
  shareGeneration: number,
): EnterpriseMeetingScreenOcrLayoutDto {
  return {
    frameId: layout.frame.id, runId: layout.frame.runId,
    shareId: layout.frame.shareId,
    shareGeneration,
    frameRevision: layout.frame.frameRevision,
    sourceSize: { width: layout.frame.sourceWidth,
      height: layout.frame.sourceHeight },
    perceptualHash: layout.frame.perceptualHash,
    capturedAt: layout.frame.capturedAt, blocks: layout.blocks,
  };
}
