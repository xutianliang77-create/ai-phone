import { NodeSerialTransport } from "./device/node-serial-transport.js";
import { AirDeviceGatewayRuntime } from
  "./runtime/air-device-gateway-runtime.js";
import { loadAirGatewayDaemonConfig } from
  "./runtime/air-gateway-config.js";
import { HttpAirGatewayCarrierEventClient } from
  "./runtime/air-gateway-carrier-client.js";
import {
  loadAirGatewayRtcNodeModule,
  RtcNodeAirDeviceRoomClient,
} from "./media/rtc-node-air-device-room-client.js";

const config = loadAirGatewayDaemonConfig();
const rtc = await loadAirGatewayRtcNodeModule();
const runtime = new AirDeviceGatewayRuntime({
  config,
  serial: new NodeSerialTransport(config.hardware.serialPath),
  createRoom: () => new RtcNodeAirDeviceRoomClient(rtc),
  carrierClient: new HttpAirGatewayCarrierEventClient({
    apiBaseUrl: config.apiBaseUrl,
    apiSecret: config.eventApiSecret,
    timeoutMs: config.commandTimeoutMs,
  }),
});

await runtime.start();
const address = runtime.address();
console.log(`air-device-gateway listening on ${config.host}:${address?.port}`);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await runtime.stop();
};

process.once("SIGINT", () => void stop().then(() => process.exit(0)));
process.once("SIGTERM", () => void stop().then(() => process.exit(0)));
