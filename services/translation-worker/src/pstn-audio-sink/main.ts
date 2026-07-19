import pino from "pino";
import { loadEnv } from "../config/env.js";
import { buildDefaultWorker } from "../main.js";
import { buildPstnAudioFrameServer } from "../worker/pstn-audio-frame-server.js";

const logger = pino({ name: "translation-worker-pstn-audio-sink" });

export function buildDefaultPstnAudioFrameSinkServer() {
  const env = loadEnv();
  return buildPstnAudioFrameServer({
    apiKey: env.audioFrameSinkApiKey,
    worker: buildDefaultWorker("pstn"),
  });
}

async function main() {
  const env = loadEnv();
  const server = buildDefaultPstnAudioFrameSinkServer();
  process.once("SIGINT", () => server.close());
  process.once("SIGTERM", () => server.close());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(env.audioFrameSinkPort, env.audioFrameSinkHost, resolve);
  });
  logger.info({
    host: env.audioFrameSinkHost,
    port: env.audioFrameSinkPort,
    configured: Boolean(env.audioFrameSinkApiKey),
  }, "Translation Worker PSTN audio frame sink started.");
}

export function isPstnAudioFrameSinkEntrypoint(argv = process.argv) {
  return argv.some((arg) =>
    arg.endsWith("src/pstn-audio-sink/main.ts") ||
    arg.endsWith("dist/pstn-audio-sink/main.js")
  );
}

if (isPstnAudioFrameSinkEntrypoint()) {
  main().catch((error) => {
    logger.error({ error }, "Translation Worker PSTN audio frame sink failed");
    process.exitCode = 1;
  });
}
