import { readFileSync, existsSync, mkdirSync, copyFileSync, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Reuse the reviewed local asset. Never download, overwrite or delete models.
const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/stage_public_ios_silero.mjs /absolute/model.mlmodelc');
if (!path.isAbsolute(source)) throw new Error('Source must be an absolute path');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'apps/mobile/ios/Runner/Models/vad/silero-vad-unified-256ms-v6.0.0.mlmodelc');
const native = readFileSync(path.join(root, 'apps/mobile/ios/Runner/AppleSpeechResources.swift'), 'utf8');
const files = [...native.matchAll(/"([a-z/._]+)": "([a-f0-9]{64})"/g)].map(([, name, sha256]) => ({ name, sha256 }));
if (files.length !== 5) throw new Error('Pinned native manifest must have exactly five files');
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
// Complete preflight before touching any destination files.
for (const { name, sha256 } of files) {
  if (hash(path.join(source, name)) !== sha256) throw new Error(`Source mismatch: ${name}`);
  if (existsSync(path.join(target, name)) && hash(path.join(target, name)) !== sha256) {
    throw new Error(`Destination differs; refusing overwrite: ${name}`);
  }
}
for (const { name } of files) {
  const dest = path.join(target, name);
  if (!existsSync(dest)) {
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(path.join(source, name), dest, constants.COPYFILE_EXCL);
  }
}
for (const { name, sha256 } of files) {
  if (hash(path.join(target, name)) !== sha256) throw new Error(`Readback mismatch: ${name}`);
}
console.log(JSON.stringify({ status: 'STAGED_HASH_VERIFIED', files: files.length, target, downloaded: false }));
