import { checkIosServiceStartupContract } from "./ios_service_startup_contract_check.mjs";

export function iosServiceStartupContractGate(root) {
  const payload = checkIosServiceStartupContract(root);
  return {
    name: "ios_service_startup_contract",
    status: payload.status === "ready" ? "pass" : "fail",
    message: serviceStartupMessage(payload),
    details: payload,
  };
}

function serviceStartupMessage(payload) {
  if (payload.status !== "ready") {
    return (payload.failures ?? [])
      .map((failure) => failure.issue)
      .filter(Boolean)
      .join("; ") || "iOS service startup contract is not ready.";
  }
  return "API/Gateway startup defaults to LAN, LM Studio, device ASR text, and server-owned history.";
}
