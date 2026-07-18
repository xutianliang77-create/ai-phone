export const enterpriseCommunicationKinds = [
  "meeting",
  "support",
  "marketing",
] as const;

export type EnterpriseCommunicationKind =
  (typeof enterpriseCommunicationKinds)[number];

export const enterpriseCommunicationStatuses = [
  "provisioning",
  "dispatching",
  "ready",
  "active",
  "degraded",
  "captions_only",
  "half_duplex",
  "draining",
  "ended",
  "cancelled",
  "failed",
] as const;

export type EnterpriseCommunicationStatus =
  (typeof enterpriseCommunicationStatuses)[number];

export interface EnterpriseCommunicationBindingRecord {
  id: string;
  tenantId: string;
  communicationSessionId: string;
  kind: EnterpriseCommunicationKind;
  businessId: string;
  status: EnterpriseCommunicationStatus;
  homeRegion: string;
  cellId: string;
  routeEpoch: number;
  policyVersion: string;
  entitlementVersion: string;
  generation: number;
  lastEventSequence: number;
  lastEventAt?: string;
  startedAt: string;
  endedAt?: string;
  updatedAt: string;
  version: number;
}

export type EnterpriseCommunicationEventDecision =
  | { status: "apply"; nextStatus: EnterpriseCommunicationStatus }
  | { status: "stale_route" | "stale_generation" | "stale_event" }
  | { status: "terminal" | "invalid_transition" };

const terminalStatuses = new Set<EnterpriseCommunicationStatus>([
  "ended",
  "cancelled",
  "failed",
]);

const activeQualityStates = [
  "active",
  "degraded",
  "captions_only",
  "half_duplex",
] as const;

const allowedTargets: Record<
  EnterpriseCommunicationStatus,
  ReadonlySet<EnterpriseCommunicationStatus>
> = {
  provisioning: new Set(["dispatching", "cancelled", "failed"]),
  dispatching: new Set([
    "ready",
    ...activeQualityStates,
    "cancelled",
    "failed",
  ]),
  ready: new Set([...activeQualityStates, "draining", "cancelled", "failed"]),
  active: new Set([...activeQualityStates, "draining", "failed"]),
  degraded: new Set([...activeQualityStates, "draining", "failed"]),
  captions_only: new Set([...activeQualityStates, "draining", "failed"]),
  half_duplex: new Set([...activeQualityStates, "draining", "failed"]),
  draining: new Set(["ended", "failed"]),
  ended: new Set(),
  cancelled: new Set(),
  failed: new Set(),
};

export function isEnterpriseCommunicationKind(
  value: unknown,
): value is EnterpriseCommunicationKind {
  return enterpriseCommunicationKinds.includes(
    value as EnterpriseCommunicationKind,
  );
}

export function isEnterpriseCommunicationStatus(
  value: unknown,
): value is EnterpriseCommunicationStatus {
  return enterpriseCommunicationStatuses.includes(
    value as EnterpriseCommunicationStatus,
  );
}

export function isTerminalEnterpriseCommunicationStatus(
  status: EnterpriseCommunicationStatus,
) {
  return terminalStatuses.has(status);
}

export function evaluateEnterpriseCommunicationEvent(
  current: EnterpriseCommunicationBindingRecord,
  event: {
    status: EnterpriseCommunicationStatus;
    routeEpoch: number;
    generation: number;
    sequence: number;
  },
): EnterpriseCommunicationEventDecision {
  if (event.routeEpoch !== current.routeEpoch) return { status: "stale_route" };
  if (event.generation < current.generation) return { status: "stale_generation" };
  if (event.generation === current.generation &&
    event.sequence <= current.lastEventSequence) {
    return { status: "stale_event" };
  }
  if (isTerminalEnterpriseCommunicationStatus(current.status)) {
    return { status: "terminal" };
  }
  if (event.status !== current.status &&
    !allowedTargets[current.status].has(event.status)) {
    return { status: "invalid_transition" };
  }
  return { status: "apply", nextStatus: event.status };
}
