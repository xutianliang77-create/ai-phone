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
  private readonly publishedVersions = new Map<string, PipelineVersion>();
  private readonly controllers = new Map<string, PipelineController>();

  identity(
    callId: string,
    speakerRole: CallAudioSpeakerRole,
    transcript: Pick<
      TranscriptSegment,
      "segmentId" | "speechId" | "turnId" | "revision"
    >,
    options: { forceNewGeneration?: boolean } = {},
  ): CallPipelineIdentity {
    const key = `${callId}:${speakerRole}:${transcript.segmentId}`;
    const revision = transcript.revision ?? 1;
    const current = this.versions.get(key);
    const generation = !current
      ? 1
      : revision > current.revision
        ? current.generation + 1
        : revision === current.revision && options.forceNewGeneration
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
    const published = this.publishedVersions.get(identity.key);
    return published !== undefined && (
      published.revision > identity.revision ||
      published.revision === identity.revision &&
        published.generation >= identity.generation
    );
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
    const published = this.publishedVersions.get(identity.key);
    if (!published || identity.revision > published.revision ||
      identity.revision === published.revision &&
        identity.generation > published.generation) {
      this.publishedVersions.set(identity.key, {
        revision: identity.revision,
        generation: identity.generation,
      });
    }
  }

  clear(callId: string) {
    this.cancel(callId);
    const prefix = `${callId}:`;
    for (const map of [this.versions, this.publishedVersions]) {
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
