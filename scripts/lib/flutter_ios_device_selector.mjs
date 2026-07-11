export function selectFlutterIosDevice(devices, options = {}) {
  const requested = options.requested ?? "";
  const allowSimulator = options.allowSimulator ?? false;
  const minIosMajor = options.minIosMajor ?? 17;
  const isIos = (device) => device.targetPlatform === "ios";
  const isSupported = (device) => {
    const major = iosMajor(device);
    return major === null || major >= minIosMajor;
  };
  const isAllowed = (device) =>
    isIos(device) && isSupported(device) && (allowSimulator || !device.emulator);

  if (requested) {
    const match = devices.find((device) =>
      device.id === requested || device.name === requested
    );
    if (!match) return fail([`DEVICE_ID was not found: ${requested}`]);
    if (!isAllowed(match)) return disallowedResult(match, allowSimulator, minIosMajor);
    return { selectedId: match.id, errors: [] };
  }

  const candidates = devices.filter(isAllowed);
  if (candidates.length === 1) {
    return { selectedId: candidates[0].id, errors: [] };
  }
  if (candidates.length > 1) {
    return fail([
      "Multiple iOS devices found. Set DEVICE_ID to one of:",
      ...candidates.map((device) => `  ${label(device)}`),
    ]);
  }

  const unsupportedIos = devices.filter((device) => isIos(device) && !isSupported(device));
  if (unsupportedIos.length > 0) {
    return fail([
      `iOS device found, but FluidAudio/CoreML Nemotron requires iOS ${minIosMajor}.0 or newer:`,
      ...unsupportedIos.map((device) => `  ${label(device)} sdk=${device.sdk || "unknown"}`),
    ]);
  }
  return fail([
    "No real iOS device found. Unlock/connect the iPhone, trust this Mac, and enable Developer Mode.",
    "Set ALLOW_IOS_SIMULATOR=true only for simulator dry runs.",
  ]);
}

function disallowedResult(device, allowSimulator, minIosMajor) {
  const errors = [`DEVICE_ID is not an allowed iOS device: ${label(device)}`];
  if (device.emulator && !allowSimulator) {
    errors.push("Set ALLOW_IOS_SIMULATOR=true only for simulator dry runs.");
  }
  const major = iosMajor(device);
  if (major !== null && major < minIosMajor) {
    errors.push(
      `FluidAudio/CoreML Nemotron requires iOS ${minIosMajor}.0 or newer. Device SDK: ${device.sdk}`,
    );
  }
  return fail(errors);
}

function iosMajor(device) {
  const match = String(device.sdk || "").match(/iOS\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

function label(device) {
  return `${device.name} (${device.id})`;
}

function fail(errors) {
  return { selectedId: null, errors };
}
