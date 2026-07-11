import type { Pcm16Audio, PstnMediaFrameRequest, TelephonyAudio, TtsAudioSinkRequest } from "./types.js";

export function toTelephonyMulaw8k(request: TtsAudioSinkRequest): TelephonyAudio {
  const pcm = Buffer.from(request.audio.data, "base64");
  const sourceSamples = pcm16Samples(pcm);
  const downsampled = downsampleTo8k(sourceSamples, request.audio.sampleRate);
  const mulaw = Buffer.alloc(downsampled.length);
  for (let index = 0; index < downsampled.length; index += 1) {
    mulaw[index] = linearToMulaw(downsampled[index]);
  }
  return {
    encoding: "mulaw8k",
    sampleRate: 8000,
    durationMs: Math.round((sourceSamples.length / request.audio.sampleRate) * 1000),
    data: mulaw.toString("base64"),
  };
}

export function fromTelephonyMulaw8k(request: PstnMediaFrameRequest): Pcm16Audio {
  const mulaw = Buffer.from(request.audio.data, "base64");
  const pcm = Buffer.alloc(mulaw.length * 4);
  for (let index = 0; index < mulaw.length; index += 1) {
    const sample = mulawToLinear(mulaw[index]);
    pcm.writeInt16LE(sample, index * 4);
    pcm.writeInt16LE(sample, index * 4 + 2);
  }
  return {
    format: "pcm16",
    sampleRate: 16000,
    data: pcm.toString("base64"),
  };
}

function pcm16Samples(buffer: Buffer): Int16Array {
  const sampleCount = Math.floor(buffer.length / 2);
  const samples = new Int16Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = buffer.readInt16LE(index * 2);
  }
  return samples;
}

function downsampleTo8k(samples: Int16Array, sourceRate: 16000 | 24000): Int16Array {
  const ratio = sourceRate / 8000;
  const outputLength = Math.floor(samples.length / ratio);
  const output = new Int16Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    output[index] = samples[Math.floor(index * ratio)];
  }
  return output;
}

function linearToMulaw(sample: number): number {
  const bias = 0x84;
  const clip = 32635;
  let pcm = Math.max(-clip, Math.min(clip, sample));
  const sign = pcm < 0 ? 0x80 : 0;
  if (pcm < 0) pcm = -pcm;
  pcm += bias;
  let exponent = 7;
  for (let mask = 0x4000; (pcm & mask) === 0 && exponent > 0; mask >>= 1) {
    exponent -= 1;
  }
  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

function mulawToLinear(value: number): number {
  const decoded = (~value) & 0xff;
  const sign = decoded & 0x80;
  const exponent = (decoded >> 4) & 0x07;
  const mantissa = decoded & 0x0f;
  const sample = (((mantissa << 3) + 0x84) << exponent) - 0x84;
  return sign ? -sample : sample;
}
