import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const [protocolPath, runRoot] = process.argv.slice(2);
if (!protocolPath || !runRoot) throw Error('base protocol and authorized run directory required');
const auth = JSON.parse(fs.readFileSync(path.join(runRoot, 'AUTHORIZATION.json')));
if (auth.userInstruction !== '允许' || auth.microphoneAllowed !== false) throw Error('wrong authorization');
const input = path.join(runRoot, 'file-inputs'), rendered = path.join(runRoot, 'rendered-source');
if (fs.existsSync(input)) throw Error('preserve frozen input directory');
fs.mkdirSync(input, { mode: 0o700 }); fs.mkdirSync(rendered, { mode: 0o700 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const base = JSON.parse(fs.readFileSync(protocolPath));
const cases = base.cases.map(c => {
  const bytes = fs.readFileSync(c.path);
  if (hash(bytes) !== c.sha256) throw Error('source fixture changed: ' + c.id);
  const filename = c.id + '.wav';
  fs.writeFileSync(path.join(input, filename), bytes, { flag: 'wx', mode: 0o600 });
  return { id: c.id, filename, samples: c.samples, sha256: c.sha256,
    reference: c.reference, expectedLanguage: c.expectedLanguage };
});
for (const [id, reference, voice, expectedLanguage] of [
  ['short_yes', 'Yes.', 'Samantha', 'en'],
  ['short_you', 'You.', 'Samantha', 'en'],
  ['short_zh_keyi', '可以。', 'Tingting', 'zh'],
]) {
  const aiff = path.join(rendered, id + '.aiff'), filename = id + '.wav';
  const wav = path.join(input, filename);
  execFileSync('/usr/bin/say', ['-v', voice, '-r', '170', '-o', aiff, reference]);
  execFileSync('/opt/homebrew/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error',
    '-n', '-i', aiff, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
  const bytes = fs.readFileSync(wav);
  cases.push({ id, filename, reference, expectedLanguage, sha256: hash(bytes), samples: sampleCount(bytes) });
}
const trials = ['zh-CN', 'en-US'].flatMap(locale =>
  cases.map(c => ({ ...c, id: locale + ':' + c.id, locale })));
const protocol = { schemaVersion: 1, frozenBeforeInference: true,
  sourceProtocolSha256: hash(fs.readFileSync(protocolPath)), input: 'prerecorded PCM16 mono 16kHz',
  feedChunkSamples: 512, maxProducerLagMs: 500, cases: cases.length, trials,
  mode: 'existing Wujie AppleSpeechSession, actual Silero and raw/accepted ASR observations',
  modelDownloadsAllowed: false, microphoneAllowed: false, cloudModelsAllowed: false,
  qualityPromotionAutomatic: false };
const output = path.join(input, 'IPHONE_PROTOCOL.json');
fs.writeFileSync(output, JSON.stringify(protocol, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ trials: trials.length, audioFiles: cases.length,
  audioBytes: cases.reduce((n, c) => n + fs.statSync(path.join(input, c.filename)).size, 0),
  protocolSha256: hash(fs.readFileSync(output)), inputDirectory: input }));

function sampleCount(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF') throw Error('not WAV');
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const length = bytes.readUInt32LE(offset + 4);
    if (bytes.toString('ascii', offset, offset + 4) === 'data') return length / 2;
    offset += 8 + length + length % 2;
  }
  throw Error('no PCM data');
}
