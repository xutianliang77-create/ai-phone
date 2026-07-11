import { iosMvpSmokeContractGate } from "./ios_mvp_smoke_contract_status_gate.mjs";
import { iosNativeAsrBridgeGate } from "./ios_native_asr_bridge_status_gate.mjs";
import { iosOnDeviceTranslationGate } from "./ios_on_device_translation_status_gate.mjs";
import { iosServiceStartupContractGate } from "./ios_service_startup_contract_status_gate.mjs";
import { iosSigningFlowContractGate } from "./ios_signing_flow_contract_status_gate.mjs";
import { mobileChineseInterfaceGate } from "./mobile_chinese_interface_status_gate.mjs";

export function iosNemotronStaticStatusGates(root) {
  return [
    mobileChineseInterfaceGate(root),
    iosNativeAsrBridgeGate(root),
    iosOnDeviceTranslationGate(root),
    iosMvpSmokeContractGate(root),
    iosSigningFlowContractGate(root),
    iosServiceStartupContractGate(root),
  ];
}
