import { checkMobileChineseInterface } from "./mobile_chinese_interface_check.mjs";

export function mobileChineseInterfaceGate(root) {
  const payload = checkMobileChineseInterface(root);
  return {
    name: "mobile_chinese_interface",
    status: payload.status === "ready" ? "pass" : "fail",
    message: chineseInterfaceMessage(payload),
    details: payload,
  };
}

function chineseInterfaceMessage(payload) {
  if (payload.status !== "ready") {
    return (payload.failures ?? [])
      .map((failure) => failure.issue)
      .filter(Boolean)
      .join("; ") || "Mobile Chinese interface metadata is not ready.";
  }
  return "Mobile interface defaults to Chinese and iOS/Android Chinese resources are ready.";
}
