#!/usr/bin/env node
import { createServer } from "node:http";

const target = new URL(process.env.ASR_PROXY_TARGET ?? "http://100.110.127.117:8021");
const port = Number(process.env.ASR_PROXY_PORT ?? 8021);
const host = process.env.ASR_PROXY_HOST ?? "0.0.0.0";

const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const url = new URL(request.url ?? "/", target);
    const upstream = await fetch(url, {
      method: request.method,
      headers: filterHeaders(request.headers),
      body: request.method === "GET" || request.method === "HEAD"
        ? undefined
        : Buffer.concat(chunks),
    });
    response.statusCode = upstream.status;
    for (const [key, value] of upstream.headers.entries()) {
      if (key.toLowerCase() === "transfer-encoding") continue;
      response.setHeader(key, value);
    }
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    response.statusCode = 502;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "asr_proxy_failed", message: error.message }));
  }
});

server.listen(port, host, () => {
  console.log(`ASR proxy listening on http://${host}:${port} -> ${target.origin}`);
});

function filterHeaders(headers) {
  const next = { ...headers };
  delete next.host;
  delete next.connection;
  delete next["content-length"];
  return next;
}
