import { loadSrtIngressBridgeConfig } from "./config.js";
import { createSrtIngressBridgeServer } from "./server.js";

const config = loadSrtIngressBridgeConfig();
const { manager, server } = createSrtIngressBridgeServer(config);

server.listen(config.healthPort, config.bindHost, () => {
  process.stdout.write(
    `srt-ingress-bridge listening on ${config.bindHost}:${config.healthPort}\n`,
  );
});

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server.close();
  await manager.drain();
  process.exit(0);
}

process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
