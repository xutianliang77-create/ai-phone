import type { AirDeviceBootAdmission } from
  "../device/air-device-boot-admission.js";
import type {
  AirDeviceSessionBinding,
  AirDeviceSessionRouter,
} from "../device/device-session-router.js";
import { bindingOf, sameSessionBinding } from
  "./air-device-gateway-runtime-support.js";

export class AirGatewayDeviceBindingController {
  constructor(private readonly dependencies: {
    deviceId: string;
    admission: AirDeviceBootAdmission;
    router: AirDeviceSessionRouter;
    suspendMedia(binding: AirDeviceSessionBinding): void;
  }) {}

  prepare(input: AirDeviceSessionBinding & { type: string }) {
    if (input.deviceId !== this.dependencies.deviceId) {
      throw new Error("Air Gateway command targets another device");
    }
    const binding = bindingOf(input);
    const active = this.dependencies.router.binding();
    if (active && !sameSessionBinding(active, binding)) {
      throw new Error("Air Gateway device session is already bound");
    }
    this.admit(binding, false);
    if (!active) {
      this.dependencies.router.bind(binding);
      return true;
    }
    return false;
  }

  restore(binding: AirDeviceSessionBinding) {
    if (binding.deviceId !== this.dependencies.deviceId) {
      throw new Error("Air Gateway recovery targets another device");
    }
    this.admit(binding, true);
    return this.dependencies.router.restoreAuthoritative(binding);
  }

  isStillAuthoritative(binding: AirDeviceSessionBinding, bootId: string) {
    const boot = this.dependencies.admission.snapshot();
    return boot.bootId === bootId && boot.heartbeat?.bootId === bootId &&
      boot.heartbeat.deviceState === "in_call" &&
      Boolean(boot.heartbeat.activeBinding &&
        sameSessionBinding(boot.heartbeat.activeBinding, binding));
  }

  rollback(input: AirDeviceSessionBinding) {
    const active = this.dependencies.router.binding();
    if (!active || !sameSessionBinding(active, bindingOf(input))) return;
    this.dependencies.suspendMedia(input);
    this.dependencies.router.disconnect("device_binding_rollback");
  }

  private admit(binding: AirDeviceSessionBinding, recovery: boolean) {
    const boot = this.dependencies.admission.snapshot();
    if (!boot.bootId || !boot.heartbeat) {
      throw new Error("Air Gateway device boot is not ready");
    }
    if (recovery && (boot.heartbeat.deviceState !== "in_call" ||
      !boot.heartbeat.activeBinding ||
      !sameSessionBinding(boot.heartbeat.activeBinding, binding))) {
      throw new Error("Air Gateway recovery heartbeat is not authoritative");
    }
    if (boot.state !== "admitted" || !boot.authorizedBinding ||
      !sameSessionBinding(boot.authorizedBinding, binding)) {
      this.dependencies.admission.completeReconcile({
        bootId: boot.bootId,
        authorizedBinding: binding,
      });
    }
  }
}
