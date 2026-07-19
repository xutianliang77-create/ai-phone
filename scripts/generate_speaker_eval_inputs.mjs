#!/usr/bin/env node
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const outputDir = resolve(process.argv[2] ?? ".cache/speaker-eval-inputs");
const force = process.argv.includes("--force");
const speakers = [
  {
    voice: "Tingting",
    texts: [
      "我是第一位发言人，现在开始介绍今天的产品计划。",
      "会议的第一个议题是确认本周的开发进度。",
      "我们需要检查实时字幕是否能够完整显示。",
      "下一步请记录说话人切换发生的准确时间。",
      "这个测试要求句子不能跨越不同的发言人。",
      "请确认中文语音能够稳定识别并翻译成英文。",
      "稍后我会继续说明服务器部署和验收安排。",
      "如果有人插话，系统应该保留真实的时间顺序。",
      "历史记录必须保存发言人标签和对应译文。",
      "第一位发言人的测试内容到这里结束。",
    ],
  },
  {
    voice: "Samantha",
    texts: [
      "I am the second speaker and I will review the delivery timeline.",
      "The first requirement is accurate speaker attribution in real time.",
      "Every translated sentence must stay inside the correct speaker turn.",
      "Please verify that quick changes do not merge two different voices.",
      "The application should preserve the original chronological order.",
      "English speech must be detected and translated back into Chinese.",
      "We also need a clear result when two participants speak together.",
      "The meeting history should contain stable anonymous speaker labels.",
      "A network interruption must not block the local end action.",
      "This completes the second speaker acceptance sample.",
    ],
  },
  {
    voice: "Fred",
    texts: [
      "I am the third speaker joining the product review meeting.",
      "My question concerns the quality of overlapping speech detection.",
      "Please keep this turn separate from all previous participants.",
    ],
  },
  {
    voice: "Kathy",
    texts: [
      "I am the fourth speaker and I will confirm the final decision.",
      "Four participant labels should remain stable during this session.",
      "The final report must include timing, identity, and translation evidence.",
    ],
  },
];

if (force) rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
let generated = 0;
for (const [speakerIndex, speaker] of speakers.entries()) {
  for (const [textIndex, text] of speaker.texts.entries()) {
    const basename = `speaker_${speakerIndex + 1}_${String(textIndex + 1).padStart(2, "0")}`;
    const wavPath = resolve(outputDir, `${basename}.wav`);
    if (existsSync(wavPath) && !force) continue;
    const aiffPath = resolve(outputDir, `${basename}.aiff`);
    run("/usr/bin/say", ["-v", speaker.voice, "-r", "170", "-o", aiffPath, text]);
    run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-i", aiffPath,
      "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", wavPath,
    ]);
    generated += 1;
  }
}

console.log(JSON.stringify({ outputDir, generated, total: 26 }, null, 2));

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} failed with ${result.status}`);
}
