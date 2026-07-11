import { checkIosMvpSmokeContract } from "./ios_mvp_smoke_contract_check.mjs";

export function iosMvpSmokeContractGate(root) {
  const payload = checkIosMvpSmokeContract(root);
  return {
    name: "ios_mvp_smoke_contract",
    status: payload.status === "ready" ? "pass" : "fail",
    message: smokeContractMessage(payload),
    details: payload,
  };
}

function smokeContractMessage(payload) {
  if (payload.status !== "ready") {
    return (payload.failures ?? [])
      .map((failure) => failure.issue)
      .filter(Boolean)
      .join("; ") || "iOS MVP smoke contract is not ready.";
  }
  return "Final iPhone smoke covers diagnostics, ASR, translation, history, and report markers.";
}
