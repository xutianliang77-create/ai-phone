import { startWebSocketServer } from "./connection/websocket-server.js";

const server = startWebSocketServer();
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  void server.shutdown().then(
    confirmed => process.exit(confirmed ? 0 : 1),
    () => process.exit(1),
  );
}
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
