export function nextActionText(input) {
  if (!input.statusEvidence.fresh) {
    return `- Run \`${devicePrefix(input)} npm run ios:nemotron:run\` to refresh status evidence.`;
  }

  if (input.failedChecks.length > 0) {
    const actions = prioritizedFailureActions(input);
    if (hasFailedCheck(input, "physical_iphone_readiness")) {
      return actions.join("\n");
    }
    for (const check of input.failedChecks) {
      actions.push(`- Fix \`${check.name}\`: ${check.message}`);
    }
    return appendEvidenceActions(actions, input).join("\n");
  }

  if ((input.pendingChecks ?? []).length > 0) {
    return [
      `- Run \`${devicePrefix(input)} npm run ios:nemotron:run\` to produce the pending real-device evidence.`,
      ...(input.pendingChecks ?? []).map((check) =>
        `- Pending \`${check.name}\`: ${check.message}`
      ),
    ].join("\n");
  }

  if (!input.preflightEvidence.pass) {
    return appendEvidenceActions([
      "- Run `npm run ios:nemotron:preflight` to refresh local build evidence.",
    ], input).join("\n");
  }

  if (!input.provisioningRepairEvidence.pass) {
    return appendEvidenceActions([
      `- Run \`${devicePrefix(input)} npm run ios:nemotron:repair-provisioning\` to refresh provisioning repair evidence.`,
    ], input).join("\n");
  }

  if (!input.signedBuildEvidence.pass) {
    return appendEvidenceActions([
      "- Run `IOS_NEMOTRON_PREFLIGHT_SIGNED_BUILD=true npm run ios:nemotron:preflight` to refresh signed device build evidence.",
    ], input).join("\n");
  }

  if (
    input.lmStudioProviderEvidence?.required !== false &&
    input.lmStudioProviderEvidence &&
    !input.lmStudioProviderEvidence.pass
  ) {
    return appendEvidenceActions([
      "- Run `npm run ios:nemotron:check-lmstudio -- --json` to verify the translation Provider.",
    ], input).join("\n");
  }

  const gatewayRequired = input.gatewayEvidence?.required !== false;
  if (!input.smokeEvidence.fresh ||
    (gatewayRequired && !input.gatewayEvidence.fresh)) {
    return `- Run \`${devicePrefix(input)} npm run ios:nemotron:run\` to refresh final smoke evidence.`;
  }

  const smokeIssues = input.smokeEvidence.issues ?? [];
  const gatewayIssues = input.gatewayEvidence.issues ?? [];
  if (
    input.missingSmoke.length > 0 ||
    input.missingGateway.length > 0 ||
    smokeIssues.length > 0 ||
    gatewayIssues.length > 0
  ) {
    return [
      `- Run \`${devicePrefix(input)} npm run ios:nemotron:run\` as the final recorded smoke.`,
      ...input.missingSmoke.map((item) =>
        `- Missing smoke marker \`${item.marker}\` for ${item.label}.`
      ),
      ...input.missingGateway.map((item) =>
        `- Missing Gateway evidence for ${item.label}: ${item.marker}.`
      ),
      ...smokeIssues.map((issue) => `- Smoke evidence issue: ${issue}`),
      ...gatewayIssues.map((issue) => `- Gateway evidence issue: ${issue}`),
    ].join("\n");
  }

  return "- MVP acceptance evidence is complete.";
}

function hasFailedCheck(input, name) {
  return input.failedChecks.some((check) => check.name === name);
}

function prioritizedFailureActions(input) {
  const names = new Set(input.failedChecks.map((check) => check.name));
  const actions = [];
  if (names.has("physical_iphone_readiness")) {
    actions.push(
      "- On the iPhone, enable Developer Mode, keep it unlocked, connect by cable, and trust this Mac.",
    );
    actions.push(
      `- Then run \`${devicePrefix(input)} npm run ios:nemotron:wait-device -- --run\` to wait for readiness, repair provisioning, and run the full MVP smoke.`,
    );
  } else if (names.has("ios_provisioning_profile")) {
    actions.push(
      `- Run \`${devicePrefix(input)} npm run ios:nemotron:repair-provisioning\` to register the device and create/update the development profile.`,
    );
  }
  return actions;
}

function appendEvidenceActions(actions, input) {
  for (const issue of input.provisioningRepairEvidence.issues ?? []) {
    actions.push(`- Provisioning repair issue: ${issue}`);
  }
  for (const action of input.provisioningRepairEvidence.actions ?? []) {
    actions.push(`- Provisioning repair action: ${action}`);
  }
  for (const issue of input.signedBuildEvidence.issues ?? []) {
    actions.push(`- Signed build issue: ${issue}`);
  }
  for (const action of input.signedBuildEvidence.actions ?? []) {
    actions.push(`- Signed build action: ${action}`);
  }
  for (const issue of input.lmStudioProviderEvidence?.issues ?? []) {
    actions.push(`- LM Studio provider issue: ${issue}`);
  }
  for (const action of input.lmStudioProviderEvidence?.actions ?? []) {
    actions.push(`- LM Studio provider action: ${action}`);
  }
  return Array.from(new Set(actions));
}

function devicePrefix(input) {
  const deviceId = input.statusEvidence.payload?.deviceId ?? "Wha的iPhone";
  return `DEVICE_ID="${deviceId}"`;
}
