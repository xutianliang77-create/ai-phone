import { buildPstnBridgeServer } from "./server.js";
import { loadEnv } from "./config.js";

const config = loadEnv();
const server = buildPstnBridgeServer();

server.listen(config.port, "0.0.0.0", () => {
  console.log(`pstn-bridge listening on 0.0.0.0:${config.port}`);
});
