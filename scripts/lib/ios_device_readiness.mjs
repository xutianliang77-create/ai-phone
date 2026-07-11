export function buildDiagnostic(devices, matches, requestedDevice = "") {
  const selectedDevices = matches.length > 0 ? matches : devices;
  return {
    schemaVersion: 1,
    requestedDevice: requestedDevice || null,
    ready: matches.length > 0 && matches.every((device) => isReadyForSmoke(device)),
    physicalDeviceCount: devices.length,
    matchedDeviceCount: matches.length,
    devices: selectedDevices.map((device) =>
      deviceSummary(
        device,
        !requestedDevice || matchesDevice(device, requestedDevice),
      )
    ),
  };
}

export function matchesDevice(device, requested) {
  const values = [
    device.deviceProperties?.name,
    device.identifier,
    device.hardwareProperties?.udid,
    device.connectionProperties?.potentialHostnames?.[0],
  ].filter(Boolean);
  return values.includes(requested);
}

export function deviceSummary(device, matched = true) {
  const name = device.deviceProperties?.name ?? "unknown";
  const model =
    device.hardwareProperties?.marketingName ??
    device.hardwareProperties?.productType ??
    "unknown";
  const udid = device.hardwareProperties?.udid ?? "unknown";
  const identifier = device.identifier ?? "unknown";
  const osVersion = device.deviceProperties?.osVersionNumber ?? "unknown";
  const pairing = device.connectionProperties?.pairingState ?? "unknown";
  const developerMode =
    device.deviceProperties?.developerModeStatus ?? "unknown";
  const tunnel = device.connectionProperties?.tunnelState ?? "unknown";
  const lastConnection =
    device.connectionProperties?.lastConnectionDate ?? "unknown";

  return {
    name,
    model,
    osVersion,
    udid,
    identifier,
    pairingState: pairing,
    developerModeStatus: developerMode,
    tunnelState: tunnel,
    lastConnectionDate: lastConnection,
    supportedIosVersion: isSupportedIosVersion(device),
    ready: isReadyForSmoke(device),
    matched,
    actions: remediationActions(device),
  };
}

export function remediationActions(device) {
  const pairing = device.connectionProperties?.pairingState;
  const developerMode = device.deviceProperties?.developerModeStatus;
  const tunnel = device.connectionProperties?.tunnelState;
  const actions = [];

  if (pairing !== "paired") {
    actions.push("unlock the iPhone, connect it by cable, and trust this Mac.");
  }
  if (developerMode !== "enabled") {
    actions.push("enable iOS Developer Mode on the iPhone, then reconnect it.");
  }
  if (tunnel !== "connected" && tunnel !== "available") {
    actions.push(
      "keep the iPhone unlocked and connected by cable, or enable same-LAN wireless development.",
    );
  }
  if (!isSupportedIosVersion(device)) {
    actions.push("use an iPhone running iOS 17.0 or newer for FluidAudio/CoreML Nemotron.");
  }
  return actions;
}

export function isReadyForSmoke(device) {
  const pairing = device.connectionProperties?.pairingState;
  const developerMode = device.deviceProperties?.developerModeStatus;
  const tunnel = device.connectionProperties?.tunnelState;
  return pairing === "paired" &&
    developerMode === "enabled" &&
    (tunnel === "connected" || tunnel === "available") &&
    isSupportedIosVersion(device);
}

export function isSupportedIosVersion(device) {
  const version = device.deviceProperties?.osVersionNumber;
  if (typeof version !== "string") return true;
  const major = Number(version.split(".")[0]);
  return Number.isNaN(major) || major >= 17;
}
