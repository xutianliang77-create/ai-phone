export interface AirGatewayHardwareRuntimeConfig {
  deploymentTarget: "beelink";
  serialPath: string;
}

export function airGatewayHardwareRuntimeConfig(input: {
  platform: string;
  env: Record<string, string | undefined>;
}): AirGatewayHardwareRuntimeConfig {
  if (input.env.AIR_GATEWAY_HARDWARE_ENABLED !== "true") {
    throw new Error("Air Gateway hardware access is disabled");
  }
  if (input.env.AIR_GATEWAY_DEPLOYMENT_TARGET !== "beelink") {
    throw new Error("Air Gateway deployment target must be beelink");
  }
  if (input.platform !== "linux") {
    throw new Error("Air Gateway hardware runtime requires Linux");
  }
  const serialPath = input.env.AIR_GATEWAY_SERIAL_PATH?.trim();
  const match = serialPath?.match(
    /^\/dev\/serial\/by-id\/usb-AirM2M_AirM2M_Compo_[A-Za-z0-9]+-if([0-9]{2})$/,
  );
  if (!serialPath || !match) {
    throw new Error("Air Gateway serial path must use a stable AirM2M by-id path");
  }
  if (match[1] !== "06") {
    throw new Error("Air Gateway serial path must select the user VUART if06");
  }
  return { deploymentTarget: "beelink", serialPath };
}

export function loadAirGatewayHardwareRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
) {
  return airGatewayHardwareRuntimeConfig({ platform: process.platform, env });
}
