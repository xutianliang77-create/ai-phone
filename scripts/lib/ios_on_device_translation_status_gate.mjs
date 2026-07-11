import { checkIosOnDeviceTranslation } from "./ios_on_device_translation_check.mjs";

export function iosOnDeviceTranslationGate(root) {
  const payload = checkIosOnDeviceTranslation(root);
  return {
    name: "ios_on_device_translation",
    status: payload.status === "ready" ? "pass" : "fail",
    message: translationMessage(payload),
    details: payload,
  };
}

function translationMessage(payload) {
  if (payload.status !== "ready") {
    return (payload.failures ?? [])
      .map((failure) => failure.issue)
      .filter(Boolean)
      .join("; ") || "iOS on-device translation bridge is not ready.";
  }
  return "Flutter provider and iOS Apple Translation bridge contract are ready.";
}
