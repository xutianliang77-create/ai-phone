import type {
  CallAudioSpeakerRole,
  TranscriptSegment,
} from "./types.js";

export interface CallPipelineIdentity {
  key: string;
  speechId: string;
  turnId: string;
  revision: number;
  generation: number;
}

export class CallPipelineVersionState {
  private readonly versions = new Map<string, PipelineVersion>();
  private readonly publishedRevisions = new Map<string, number>();
  private readonly controllers = new Map<string, PipelineController>();

  identity(
    callId: string,
    speakerRole: CallAudioSpeakerRole,
    transcript: Pick<
      TranscriptSegment,
      "segmentId" | "speechId" | "turnId" | "revision"
    >,
  ): CallPipelineIdentity {
    const key = `${callId}:${speakerRole}:${transcript.segmentId}`;
    const revision = transcript.revision ?? 1;
    const current = this.versions.get(key);
    const generation = !current
      ? 1
      : revision > current.revision
        ? current.generation + 1
        : current.generation;
    if (!current || revision >= current.revision) {
      this.versions.set(key, { revision, generation });
    }
    const turnId = transcript.turnId ??
      `turn:${speakerRole}:${transcript.segmentId}`;
    return {
      key,
      speechId: transcript.speechId ?? `speech:${speakerRole}:${turnId}`,
      turnId,
      revision,
      generation,
    };
  }

  isPublished(identity: CallPipelineIdentity) {
    return (this.publishedRevisions.get(identity.key) ?? -1) >=
      identity.revision;
  }

  activate(identity: CallPipelineIdentity) {
    const current = this.controllers.get(identity.key);
    if (current?.generation === identity.generation &&
      !current.controller.signal.aborted) {
      return current.controller.signal;
    }
    current?.controller.abort();
    const controller = new AbortController();
    this.controllers.set(identity.key, {
      generation: identity.generation,
      controller,
    });
    return controller.signal;
  }

  isCurrent(identity: CallPipelineIdentity) {
    const version = this.versions.get(identity.key);
    const active = this.controllers.get(identity.key);
    return version?.revision === identity.revision &&
      version.generation === identity.generation &&
      active?.generation === identity.generation &&
      !active.controller.signal.aborted;
  }

  markPublished(identity: CallPipelineIdentity) {
    this.publishedRevisions.set(
      identity.key,
      Math.max(
        this.publishedRevisions.get(identity.key) ?? -1,
        identity.revision,
      ),
    );
  }

  clear(callId: string) {
    this.cancel(callId);
    const prefix = `${callId}:`;
    for (const map of [this.versions, this.publishedRevisions]) {
      for (const key of map.keys()) {
        if (key.startsWith(prefix)) map.delete(key);
      }
    }
  }

  cancel(callId: string) {
    this.cancelPrefix(`${callId}:`);
  }

  cancelSpeaker(callId: string, speakerRole: CallAudioSpeakerRole) {
    this.cancelPrefix(`${callId}:${speakerRole}:`);
  }

  private cancelPrefix(prefix: string) {
    for (const [key, active] of this.controllers) {
      if (!key.startsWith(prefix)) continue;
      active.controller.abort();
      this.controllers.delete(key);
    }
  }
}

interface PipelineVersion {
  revision: number;
  generation: number;
}

interface PipelineController {
  generation: number;
  controller: AbortController;
}
