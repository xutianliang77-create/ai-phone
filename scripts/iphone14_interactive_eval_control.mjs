import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { createServer } from "node:http";
import {
  readJsonBody,
  sendJson,
} from "./iphone14_interactive_eval_io.mjs";

export function startControlServer(context) {
  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") {
        sendJson(response, 200, {
          status: "ok",
          providerId: context.providerId,
          modelId: context.modelId,
          nextSampleId: context.loadState().nextSampleId ??
            context.inferNextSampleId(),
        });
        return;
      }
      if (request.method === "GET" && request.url === "/next") {
        const sample = context.sampleById(
          context.loadState().nextSampleId ?? context.inferNextSampleId(),
        );
        sendJson(response, 200, {
          sampleId: sample.id,
          providerId: context.providerId,
          modelId: context.modelId,
          localeId: context.localeForSample(sample),
          text: sample.text,
          audio: context.relativePath(context.audioPathForSample(sample)),
        });
        return;
      }
      if (request.method !== "POST") {
        sendJson(response, 405, { error: "method_not_allowed" });
        return;
      }
      const payload = await readJsonBody(request);
      if (request.url === "/start") {
        context.startSampleFromApp(payload);
        sendJson(response, 200, {
          started: true,
          sampleId: context.loadState().activeSampleId,
        });
        return;
      }
      if (request.url === "/stop") {
        const result = context.stopAndPullFromApp(payload);
        sendJson(response, 200, { stopped: true, ...result });
        return;
      }
      sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      console.error(error);
      sendJson(response, 500, {
        error: "server_error",
        message: error.message,
      });
    }
  });
  server.listen(context.port, "0.0.0.0", () => {
    console.log(
      `iPhone14 eval control server listening on http://0.0.0.0:${context.port}`,
    );
    context.printStatus();
  });
}

export function watchControlEvents(context) {
  mkdirSync(dirname(context.eventsPath), { recursive: true });
  if (!existsSync(context.eventsPath)) writeFileSync(context.eventsPath, "");
  let position = statSync(context.eventsPath).size;
  console.log(`监听 App 开始/停止事件：${context.relativePath(context.eventsPath)}`);
  setInterval(() => {
    const size = statSync(context.eventsPath).size;
    if (size <= position) return;
    const text = readFileSync(context.eventsPath, "utf8").slice(position);
    position = size;
    for (const line of text.split("\n").filter(Boolean)) {
      printControlEvent(JSON.parse(line), context);
    }
  }, 500);
}

function printControlEvent(event, context) {
  if (event.type === "start") {
    console.log(
      `\n开始播放：${event.sampleId}（${event.providerId ?? context.providerId} / ${event.localeId}）`,
    );
    console.log(`原文：${event.text}`);
    console.log(`音频：${event.audio}`);
    return;
  }
  if (event.type === "playbackComplete") {
    console.log(`播放完成：${event.sampleId}。现在请点 App 的“停止”。`);
    return;
  }
  if (event.type === "stop") {
    context.printStopResult(event.result, event.summary, event.next);
  }
}
