import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function writeLocalTtsEvidence(input: {
  directory: string;
  requestId: string;
  text: string;
  pcm: Buffer;
  sampleRate: number;
}) {
  if (!/^voice-tts-[0-9a-f-]{36}$/.test(input.requestId)) {
    throw new Error("Invalid TTS evidence request id");
  }
  const wav = pcm16MonoWav(input.pcm, input.sampleRate);
  const pcmSha256 = digest(input.pcm);
  const wavSha256 = digest(wav);
  await mkdir(input.directory, { recursive: true, mode: 0o700 });
  await writeFile(join(input.directory, `${input.requestId}.wav`), wav, {
    flag: "wx",
    mode: 0o600,
  });
  await writeFile(
    join(input.directory, `${input.requestId}.json`),
    `${JSON.stringify({
      requestId: input.requestId,
      text: input.text,
      sampleRate: input.sampleRate,
      channels: 1,
      format: "pcm_s16le",
      pcmBytes: input.pcm.length,
      wavBytes: wav.length,
      pcmSha256,
      wavSha256,
      createdAt: new Date().toISOString(),
    }, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
}

function pcm16MonoWav(pcm: Buffer, sampleRate: number) {
  if (!pcm.length || pcm.length % 2 !== 0) {
    throw new Error("TTS evidence PCM must contain complete samples");
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function digest(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
