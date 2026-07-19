import { buildPstnBridgeServer } from "./server.js";
import { loadEnv } from "./config.js";

const config = loadEnv();
const server = buildPstnBridgeServer();

server.listen(config.port, config.host, () => {
  console.log(`pstn-bridge listening on ${config.host}:${config.port}`);
});
