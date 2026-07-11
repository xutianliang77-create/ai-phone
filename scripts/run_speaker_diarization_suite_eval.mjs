#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import {
  evaluateSpeakerDiarization,
  evaluateSpeakerLabelStability,
} from "./lib/speaker_eval_metrics.mjs";

const [predictionPath, outputPath] = process.argv.slice(2);
if (!predictionPath) {
  console.error("Usage: run_speaker_diarization_suite_eval.mjs predictions.json [report.json]");
  process.exit(1);
}

const suite = JSON.parse(readFileSync(predictionPath, "utf8"));
const thresholds = {
  maxDer: Number(process.env.SPEAKER_EVAL_MAX_DER ?? 0.2),
  maxLongDer: Number(process.env.SPEAKER_EVAL_MAX_LONG_DER ?? 0.18),
  maxLabelDriftEvents: Number(process.env.SPEAKER_EVAL_MAX_DRIFT_EVENTS ?? 0),
  maxStableSpeakers: Number(process.env.SPEAKER_EVAL_MAX_STABLE_SPEAKERS ?? 4),
};
const cases = suite.cases.map((item) => {
  const metrics = evaluateSpeakerDiarization(item);
  const stability = evaluateSpeakerLabelStability(item);
  const limit = item.id === "long_30m" ? thresholds.maxLongDer : thresholds.maxDer;
  const stabilityPassed = item.id !== "long_30m" || (
    stability.labelDriftEvents <= thresholds.maxLabelDriftEvents &&
    stability.stableSpeakerCount <= thresholds.maxStableSpeakers
  );
  return {
    id: item.id,
    audio: item.audio,
    limit,
    passed: metrics.diarizationErrorRate <= limit && stabilityPassed,
    ...metrics,
    ...stability,
  };
});
const report = {
  generatedAt: new Date().toISOString(),
  model: suite.model,
  status: cases.every((item) => item.passed) ? "passed" : "failed",
  thresholds,
  cases,
};
if (outputPath) writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (report.status !== "passed") process.exit(2);
