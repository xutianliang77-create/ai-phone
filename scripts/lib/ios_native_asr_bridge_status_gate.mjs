import { checkIosNativeAsrBridge } from "./ios_native_asr_bridge_check.mjs";

export function iosNativeAsrBridgeGate(root) {
  const payload = checkIosNativeAsrBridge(root);
  return {
    name: "ios_native_asr_bridge",
    status: payload.status === "ready" ? "pass" : "fail",
    message: bridgeMessage(payload),
    details: payload,
  };
}

function bridgeMessage(payload) {
  if (payload.status !== "ready") {
    return (payload.failures ?? [])
      .map((failure) => failure.issue)
      .filter(Boolean)
      .join("; ") || "iOS native ASR bridge contract is not ready.";
  }
  return "Flutter provider and iOS Swift ASR bridge contract are ready.";
}
