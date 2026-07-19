#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { evaluateSpeakerDiarization } from "./lib/speaker_eval_metrics.mjs";

const [fixturePath, outputPath] = process.argv.slice(2);
if (!fixturePath) {
  console.error("Usage: run_speaker_diarization_eval.mjs fixture.json [output.json]");
  process.exit(1);
}

const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const result = {
  generatedAt: new Date().toISOString(),
  fixture: fixturePath,
  ...evaluateSpeakerDiarization(fixture),
};
if (outputPath) writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));

const maxDer = Number(process.env.SPEAKER_EVAL_MAX_DER ?? 0.2);
if (result.diarizationErrorRate > maxDer) process.exit(2);
