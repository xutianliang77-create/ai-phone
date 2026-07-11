import { checkIosSigningFlowContract } from "./ios_signing_flow_contract_check.mjs";

export function iosSigningFlowContractGate(root) {
  const payload = checkIosSigningFlowContract(root);
  return {
    name: "ios_signing_flow_contract",
    status: payload.status === "ready" ? "pass" : "fail",
    message: signingFlowMessage(payload),
    details: payload,
  };
}

function signingFlowMessage(payload) {
  if (payload.status !== "ready") {
    return (payload.failures ?? [])
      .map((failure) => failure.issue)
      .filter(Boolean)
      .join("; ") || "iOS signing/provisioning flow contract is not ready.";
  }
  return "Provisioning repair, signed build evidence, and report wiring are ready.";
}
