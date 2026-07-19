import type {
  EnterpriseSupportChannelRecord,
  EnterpriseSupportChannelType,
  EnterpriseSupportSessionAggregate,
} from "./enterprise-support.js";
import type { EnterpriseSupportInboundEvent } from "@translation/contracts";

export type { EnterpriseSupportInboundEvent } from "@translation/contracts";

export interface EnterpriseSupportInboundRoute {
  tenantId: string;
  channelId: string;
  channelType: EnterpriseSupportChannelType;
  homeRegion: string;
  cellId: string;
  routeEpoch: number;
}

export interface EnterpriseSupportInboundAuthorization {
  route: EnterpriseSupportInboundRoute;
  channel: EnterpriseSupportChannelRecord;
}

export type EnterpriseSupportInboundResult =
  | { status: "created" | "replayed"; aggregate: EnterpriseSupportSessionAggregate }
  | { status: "event_conflict" | "channel_not_found" | "channel_unavailable" |
      "route_not_ready" | "policy_not_ready" | "entitlement_not_ready" };
