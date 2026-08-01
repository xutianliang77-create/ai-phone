import type { CallAudioSpeakerRole } from "./types.js";

export class LiveKitCallRoleTrackGate {
  private readonly activeSourceKeyByRole = new Map<CallAudioSpeakerRole, string>();

  reserve(speakerRole: CallAudioSpeakerRole, sourceKey: string) {
    const activeSourceKey = this.activeSourceKeyByRole.get(speakerRole);
    if (activeSourceKey && activeSourceKey !== sourceKey) return false;
    this.activeSourceKeyByRole.set(speakerRole, sourceKey);
    return true;
  }

  release(speakerRole: CallAudioSpeakerRole, sourceKey: string) {
    if (this.activeSourceKeyByRole.get(speakerRole) === sourceKey) {
      this.activeSourceKeyByRole.delete(speakerRole);
    }
  }
}
