export async function probeApiModelRouting(context) {
  const routing = await context.requestJson(`${context.baseUrl}/models/routing`, {
    ...context,
    allowError: true,
  });
  const routeOk =
    [200, 503].includes(routing.status) &&
    ["ready", "not_ready"].includes(routing.body?.status) &&
    Array.isArray(routing.body?.profiles);
  context.record(context.checks, "api_model_routing_route", routeOk, {
    httpStatus: routing.status,
    status: routing.body?.status,
    activeProfile: routing.body?.activeProfile,
    issues: routing.body?.issues ?? [],
  });
  if (!routeOk) {
    context.issues.push(
      "api /models/routing route is missing or malformed.",
    );
    context.actions.push(
      `Restart api from the current workspace and inspect ${context.logPath}.`,
    );
  }
}
