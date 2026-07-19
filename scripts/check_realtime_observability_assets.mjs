#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkRealtimeObservabilityAssets } from
  "./lib/realtime_observability_assets.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const result = checkRealtimeObservabilityAssets(root);

console.log(JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  ...result,
}, null, 2));

if (result.status !== "ready") process.exitCode = 1;
