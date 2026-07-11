import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corpusPath = join(rootDir, "data/realtime-online-eval/realtime-online-test-set-v1.jsonl");
const outDir = join(rootDir, "test-audio/realtime-online-eval-v1");
const generatedDir = join(outDir, ".generated");
const wavDir = join(outDir, "clean-24k-wav");
const m4aDir = join(outDir, "m4a");
const sampleRate = 24000;
const defaultGapMs = 1800;
const command = process.argv[2] ?? "all";

const cases = readJsonl(corpusPath);
mkdirSync(generatedDir, { recursive: true });
mkdirSync(wavDir, { recursive: true });
mkdirSync(m4aDir, { recursive: true });

for (const testCase of cases) generateCaseAudio(testCase);
generateSuite("p0-smoke", cases.filter((item) => item.priority === "P0"));
if (command === "all") generateSuite("full-regression", cases);
writeManifest(cases);

console.log(`Generated ${cases.length} cases in ${relativePath(outDir)}`);

function generateCaseAudio(testCase) {
  const partFiles = [];
  const parts = testCase.audio?.parts ?? [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const prefix = `${testCase.id}-part-${index}`;
    const aiffPath = join(generatedDir, `${prefix}.aiff`);
    const wavPath = join(generatedDir, `${prefix}.wav`);
    run("say", ["-v", part.voice, "-r", String(part.rate ?? 160), "-o", aiffPath, part.text]);
    run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", aiffPath,
      "-ac", "1", "-ar", String(sampleRate), "-sample_fmt", "s16",
      wavPath,
    ]);
    partFiles.push(wavPath);
    const gapMs = part.gapAfterMs ?? (index < parts.length - 1 ? defaultGapMs : 0);
    if (gapMs > 0) {
      const gapPath = join(generatedDir, `${prefix}-gap.wav`);
      makeSilence(gapPath, gapMs);
      partFiles.push(gapPath);
    }
  }

  const wavOut = join(wavDir, `${testCase.id}.wav`);
  concatWav(partFiles, wavOut);
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", wavOut,
    "-c:a", "aac", "-b:a", "128k",
    join(m4aDir, `${testCase.id}.m4a`),
  ]);
}

function generateSuite(name, selectedCases) {
  const files = [];
  for (const testCase of selectedCases) {
    files.push(join(wavDir, `${testCase.id}.wav`));
    const gapPath = join(generatedDir, `${name}-${testCase.id}-gap.wav`);
    makeSilence(gapPath, 2500);
    files.push(gapPath);
  }
  const wavOut = join(outDir, `${name}-24k.wav`);
  concatWav(files, wavOut);
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", wavOut,
    "-c:a", "aac", "-b:a", "128k",
    join(outDir, `${name}.m4a`),
  ]);
}

function makeSilence(path, ms) {
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `anullsrc=r=${sampleRate}:cl=mono`,
    "-t", String(ms / 1000),
    "-ac", "1", "-ar", String(sampleRate), "-sample_fmt", "s16",
    path,
  ]);
}

function concatWav(files, outputPath) {
  const listPath = join(generatedDir, `${basenameWithoutExt(outputPath)}.txt`);
  writeFileSync(listPath, files.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join("\n") + "\n");
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "concat", "-safe", "0", "-i", listPath,
    "-ac", "1", "-ar", String(sampleRate), "-sample_fmt", "s16",
    outputPath,
  ]);
}

function writeManifest(items) {
  const lines = [
    "# Realtime Online Eval V1",
    "",
    "Use these files for iPhone online-mode real-device testing.",
    "",
    "## Combined Audio",
    "",
    "- `p0-smoke.m4a`: required P0 suite.",
    "- `full-regression.m4a`: P0 + P1 regression suite.",
    "",
    "## Cases",
    "",
    "| ID | Priority | Source | Target | Text |",
    "|---|---|---|---|---|",
    ...items.map((item) =>
      `| ${item.id} | ${item.priority} | ${item.sourceLanguage} | ${item.targetLanguage} | ${item.text} |`
    ),
    "",
  ];
  writeFileSync(join(outDir, "README.md"), lines.join("\n"));
}

function readJsonl(path) {
  if (!existsSync(path)) throw new Error(`Missing corpus: ${path}`);
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function run(commandName, args) {
  const result = spawnSync(commandName, args, { stdio: "pipe" });
  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim();
    throw new Error(`${commandName} failed${stderr ? `: ${stderr}` : ""}`);
  }
}

function basenameWithoutExt(path) {
  return path.split("/").at(-1)?.replace(/\.[^.]+$/, "") ?? "audio";
}

function relativePath(path) {
  return path.replace(`${rootDir}/`, "");
}
