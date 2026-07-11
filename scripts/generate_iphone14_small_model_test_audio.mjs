import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = join(rootDir, "data/model-eval/iphone14-small-models/iphone14-test-set-v1.jsonl");
const outDir = join(rootDir, "test-audio/iphone14-small-models");
const tmpDir = join(outDir, ".generated");
const sampleRate = 24000;

const args = new Set(process.argv.slice(2));
const renderAll = args.has("--all");
const renderCore = args.has("--core") || !renderAll;

const ffmpeg = findBinary(process.env.FFMPEG, ["/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg", "ffmpeg"]);
const say = findBinary(process.env.SAY, ["/usr/bin/say", "say"]);

const samples = readFileSync(dataPath, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter((sample) => renderAll || (renderCore && sample.priority === "P0"));

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });

const rendered = [];
for (const sample of samples) {
  rendered.push(renderSample(sample));
}

const cleanSuite = makeSuite("iphone14-small-models-core-clean", rendered.map((item) => item.wav));
const phoneSuite = makeSuite(
  "iphone14-small-models-core-phone8k",
  rendered.filter((item) => item.sample.audio?.variant === "phone_8k").map((item) => item.phoneWav),
  8000,
);
const noiseSuite = makeSuite(
  "iphone14-small-models-core-mild-noise",
  rendered.filter((item) => item.sample.audio?.variant === "mild_noise").map((item) => item.noiseWav),
);

writeManifest([cleanSuite, phoneSuite, noiseSuite].filter(Boolean), rendered);

console.log(JSON.stringify({
  samples: rendered.length,
  outDir,
  suites: [cleanSuite, phoneSuite, noiseSuite].filter(Boolean),
}, null, 2));

function renderSample(sample) {
  const safeId = sample.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const aiff = join(tmpDir, `${safeId}.aiff`);
  const wav = join(outDir, `${safeId}-24k.wav`);
  const m4a = join(outDir, `${safeId}.m4a`);
  const phoneWav = join(outDir, `${safeId}-phone8k.wav`);
  const noiseWav = join(outDir, `${safeId}-mild-noise-24k.wav`);
  const voice = sample.audio?.voice ?? (sample.language === "en" ? "Samantha" : "Tingting");
  const rate = String(sample.audio?.rate ?? 165);

  renderSpeechWav({ sample, safeId, aiff, wav, voice, rate });
  spawnChecked(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-c:a", "aac", "-b:a", "128k", m4a]);
  spawnChecked(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-ac", "1", "-ar", "8000", "-sample_fmt", "s16", phoneWav]);
  spawnChecked(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", wav,
    "-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.012:r=24000",
    "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=first:normalize=0",
    "-ac", "1", "-ar", String(sampleRate), "-sample_fmt", "s16",
    noiseWav,
  ]);

  return { sample, wav, m4a, phoneWav, noiseWav };
}

function renderSpeechWav({ sample, safeId, aiff, wav, voice, rate }) {
  if (!shouldRenderAsMixedSpeech(sample)) {
    spawnChecked(say, ["-v", voice, "-r", rate, "-o", aiff, sample.text]);
    spawnChecked(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", aiff, "-ac", "1", "-ar", String(sampleRate), "-sample_fmt", "s16", wav]);
    return;
  }

  const segmentWavs = splitBySpeechLanguage(sample.text).map((segment, index) => {
    const segmentAiff = join(tmpDir, `${safeId}-part-${index}.aiff`);
    const segmentWav = join(tmpDir, `${safeId}-part-${index}.wav`);
    const segmentVoice = segment.language === "zh" ? "Tingting" : "Samantha";
    spawnChecked(say, ["-v", segmentVoice, "-r", rate, "-o", segmentAiff, segment.text]);
    spawnChecked(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", segmentAiff, "-ac", "1", "-ar", String(sampleRate), "-sample_fmt", "s16", segmentWav]);
    return segmentWav;
  });
  const concatPath = join(tmpDir, `${safeId}-parts.txt`);
  writeFileSync(concatPath, segmentWavs.map((file) => `file '${file}'`).join("\n") + "\n");
  spawnChecked(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", concatPath, "-ac", "1", "-ar", String(sampleRate), "-sample_fmt", "s16", wav]);
}

function shouldRenderAsMixedSpeech(sample) {
  return sample.language === "mixed"
    || (containsHan(sample.text) && /[A-Za-z]/.test(sample.text));
}

function splitBySpeechLanguage(text) {
  const segments = [];
  let currentLanguage = null;
  let currentText = "";
  for (const char of text) {
    const language = speechLanguageForChar(char, currentLanguage);
    if (currentLanguage && language !== currentLanguage && currentText.trim()) {
      segments.push({ language: currentLanguage, text: currentText.trim() });
      currentText = "";
    }
    currentLanguage = language;
    currentText += char;
  }
  if (currentLanguage && currentText.trim()) {
    segments.push({ language: currentLanguage, text: currentText.trim() });
  }
  return segments.length > 0 ? segments : [{ language: "en", text }];
}

function speechLanguageForChar(char, currentLanguage) {
  if (containsHan(char)) return "zh";
  if (/[A-Za-z0-9]/.test(char)) return "en";
  return currentLanguage ?? "en";
}

function containsHan(text) {
  return /\p{Script=Han}/u.test(text);
}

function makeSuite(name, files, outputSampleRate = sampleRate) {
  if (files.length === 0) return null;
  const concatPath = join(tmpDir, `${name}.txt`);
  const silence = join(tmpDir, `${name}-gap.wav`);
  const rateSuffix = outputSampleRate === 8000 ? "8k" : "24k";
  const wavOut = join(outDir, `${name}-${rateSuffix}.wav`);
  const m4aOut = join(outDir, `${name}.m4a`);

  spawnChecked(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `anullsrc=r=${outputSampleRate}:cl=mono`,
    "-t", "1.2", "-ac", "1", "-ar", String(outputSampleRate), "-sample_fmt", "s16",
    silence,
  ]);

  writeFileSync(
    concatPath,
    files.flatMap((file) => [`file '${file}'`, `file '${silence}'`]).join("\n") + "\n",
  );
  spawnChecked(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", concatPath, "-ac", "1", "-ar", String(outputSampleRate), "-sample_fmt", "s16", wavOut]);
  spawnChecked(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", wavOut, "-c:a", "aac", "-b:a", "128k", m4aOut]);
  return { name, wav: wavOut, m4a: m4aOut, samples: files.length };
}

function writeManifest(suites, renderedSamples) {
  const lines = [
    "# iPhone 14 Small Model Test Audio",
    "",
    "Generated from `data/model-eval/iphone14-small-models/iphone14-test-set-v1.jsonl`.",
    "",
    "## Suites",
    "",
    ...suites.map((suite) => `- ${suite.name}: ${suite.samples} samples, \`${suite.m4a.replace(`${rootDir}/`, "")}\``),
    "",
    "## Samples",
    "",
    ...renderedSamples.map((item, index) => `${index + 1}. ${item.sample.id} [${item.sample.group}, ${item.sample.language}] ${item.sample.text}`),
    "",
  ];
  writeFileSync(join(outDir, "iphone14-small-models-audio-manifest.md"), lines.join("\n"));
}

function findBinary(envPath, candidates) {
  if (envPath) return envPath;
  for (const candidate of candidates) {
    if (candidate.startsWith("/") && existsSync(candidate)) return candidate;
    if (!candidate.startsWith("/")) return candidate;
  }
  throw new Error(`Missing binary: ${candidates.join(", ")}`);
}

function spawnChecked(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${result.status}`);
  }
}
