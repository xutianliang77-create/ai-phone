import type { ConnectionState, Room } from "livekit-client";
import type { EnterpriseMeetingJoinTokenResponse } from "@translation/contracts";

export interface EnterpriseMeetingRoomSnapshot {
  status: "disconnected" | "connecting" | "connected" | "reconnecting";
  microphoneEnabled: boolean;
  remoteParticipantCount: number;
}

export class EnterpriseMeetingRoomClient {
  private room: Room | null = null;
  private snapshot: EnterpriseMeetingRoomSnapshot = {
    status: "disconnected",
    microphoneEnabled: false,
    remoteParticipantCount: 0,
  };

  constructor(
    private readonly onSnapshot: (value: EnterpriseMeetingRoomSnapshot) => void,
  ) {}

  async connect(grant: EnterpriseMeetingJoinTokenResponse) {
    await this.disconnect();
    this.emit({ status: "connecting" });
    const { Room, RoomEvent } = await import("livekit-client");
    const room = new Room({ adaptiveStream: true, dynacast: true });
    this.room = room;
    room
      .on(RoomEvent.ConnectionStateChanged, (state) => {
        this.emit({ status: connectionStatus(state) });
      })
      .on(RoomEvent.ParticipantConnected, () => this.syncParticipants())
      .on(RoomEvent.ParticipantDisconnected, () => this.syncParticipants())
      .on(RoomEvent.Disconnected, () => {
        this.emit({
          status: "disconnected",
          microphoneEnabled: false,
          remoteParticipantCount: 0,
        });
      });
    try {
      await room.connect(grant.rtcUrl, grant.accessToken, { autoSubscribe: true });
      await room.localParticipant.setMicrophoneEnabled(true);
      this.emit({
        status: "connected",
        microphoneEnabled: room.localParticipant.isMicrophoneEnabled,
        remoteParticipantCount: room.remoteParticipants.size,
      });
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }

  async setMicrophoneEnabled(enabled: boolean) {
    const room = this.room;
    if (!room || String(room.state) !== "connected") return;
    await room.localParticipant.setMicrophoneEnabled(enabled);
    this.emit({ microphoneEnabled: room.localParticipant.isMicrophoneEnabled });
  }

  async disconnect() {
    const room = this.room;
    this.room = null;
    if (room) {
      room.removeAllListeners();
      await room.disconnect();
    }
    this.emit({
      status: "disconnected",
      microphoneEnabled: false,
      remoteParticipantCount: 0,
    });
  }

  private syncParticipants() {
    if (this.room) {
      this.emit({ remoteParticipantCount: this.room.remoteParticipants.size });
    }
  }

  private emit(value: Partial<EnterpriseMeetingRoomSnapshot>) {
    this.snapshot = { ...this.snapshot, ...value };
    this.onSnapshot(this.snapshot);
  }
}

function connectionStatus(state: ConnectionState): EnterpriseMeetingRoomSnapshot["status"] {
  if (String(state) === "connected") return "connected";
  if (String(state) === "reconnecting") return "reconnecting";
  if (String(state) === "connecting") return "connecting";
  return "disconnected";
}
