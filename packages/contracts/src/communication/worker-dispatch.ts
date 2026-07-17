export type WorkerDispatchStatus =
  | "reserved"
  | "dispatching"
  | "dispatched"
  | "ready"
  | "draining"
  | "completed"
  | "failed";

export interface WorkerDispatchDto {
  id: string;
  callId: string;
  sessionId: string;
  roomName: string;
  provider: "local_process" | "livekit_dispatch";
  agentName: string;
  status: WorkerDispatchStatus;
  generation: number;
  version: number;
  operationId?: string;
  externalDispatchId?: string;
  jobId?: string;
  workerId?: string;
  metadataHash?: string;
  leaseExpiresAt: string;
  createdAt: string;
  updatedAt: string;
  readyAt?: string;
  lastHeartbeatAt?: string;
  endedAt?: string;
  lastErrorClass?: string;
}

export type WorkerCapacityReservationStatus =
  | "held"
  | "released"
  | "expired";

export interface WorkerCapacityReservationDto {
  id: string;
  sessionId: string;
  resource: "translation_runtime" | "voice_agent_runtime";
  units: number;
  status: WorkerCapacityReservationStatus;
  owner: string;
  leaseExpiresAt: string;
  createdAt: string;
  updatedAt: string;
  releasedAt?: string;
}
