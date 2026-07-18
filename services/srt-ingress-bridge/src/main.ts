import { loadSrtIngressBridgeConfig } from "./config.js";
import { createSrtIngressBridgeServer } from "./server.js";

const config = loadSrtIngressBridgeConfig();
const { manager, server } = createSrtIngressBridgeServer(config);

server.listen(config.healthPort, "127.0.0.1", () => {
  process.stdout.write(`srt-ingress-bridge listening on 127.0.0.1:${config.healthPort}\n`);
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
