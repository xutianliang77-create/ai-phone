export interface SessionHomeRouting {
  homeRegion: string;
  homeCellId: string;
  routingGeneration: number;
}

export function currentSessionHomeRouting(): SessionHomeRouting {
  return {
    homeRegion: normalized(process.env.PLATFORM_REGION, "local"),
    homeCellId: normalized(process.env.PLATFORM_CELL_ID, "single-node"),
    routingGeneration: positiveInteger(process.env.PLATFORM_ROUTING_GENERATION, 1),
  };
}

export function getPlatformRoutingReadiness() {
  const multiNode = process.env.PLATFORM_MULTI_NODE_ENABLED === "true";
  const acceptNewSessions = process.env.PLATFORM_ACCEPT_NEW_SESSIONS !== "false";
  const routing = currentSessionHomeRouting();
  const issues = multiNode ? [
    ...(routing.homeRegion === "local" ? ["PLATFORM_REGION is required"] : []),
    ...(routing.homeCellId === "single-node" ? ["PLATFORM_CELL_ID is required"] : []),
    ...(process.env.PLATFORM_ROUTING_GENERATION
      ? []
      : ["PLATFORM_ROUTING_GENERATION is required"]),
    ...(process.env.PLATFORM_SESSION_PLACEMENT === "home_region_sticky"
      ? []
      : ["Session placement must be home_region_sticky"]),
  ] : [];
  return {
    status: !multiNode ? "disabled" as const
      : issues.length === 0 ? "ready" as const : "not_ready" as const,
    acceptNewSessions,
    ...routing,
    issues,
  };
}

export function assertNewSessionPlacementAllowed() {
  const readiness = getPlatformRoutingReadiness();
  if (!readiness.acceptNewSessions) {
    throw new Error("This cell is draining and does not accept new sessions");
  }
  if (readiness.status === "not_ready") {
    throw new Error(`Session routing is not ready: ${readiness.issues.join("; ")}`);
  }
  return currentSessionHomeRouting();
}

function normalized(value: string | undefined, fallback: string) {
  const text = value?.trim();
  return text && /^[a-z0-9-]{2,64}$/.test(text) ? text : fallback;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}
