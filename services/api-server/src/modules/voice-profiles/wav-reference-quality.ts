export interface VoiceReferenceQuality {
  accepted: boolean;
  durationMs: number;
  sampleRate: number;
  channels: number;
  rmsDbfs: number;
  clippingRatio: number;
  silenceRatio: number;
  dcOffset: number;
  issues: string[];
}

export function analyzeWavReference(audio: Buffer): VoiceReferenceQuality | null {
  const parsed = parsePcm16Wav(audio);
  if (!parsed) return null;
  const { sampleRate, channels, samples } = parsed;
  const frameCount = Math.floor(samples.length / channels);
  if (frameCount === 0) return null;
  let sumSquares = 0;
  let sum = 0;
  let clipped = 0;
  let silent = 0;
  for (const sample of samples) {
    const value = sample / 32768;
    sum += value;
    sumSquares += value * value;
    if (Math.abs(value) >= 0.98) clipped += 1;
    if (Math.abs(value) < 0.01) silent += 1;
  }
  const count = samples.length;
  const rms = Math.sqrt(sumSquares / count);
  const quality: VoiceReferenceQuality = {
    accepted: true,
    durationMs: Math.round(frameCount / sampleRate * 1000),
    sampleRate,
    channels,
    rmsDbfs: round(20 * Math.log10(Math.max(rms, 1e-9))),
    clippingRatio: round(clipped / count),
    silenceRatio: round(silent / count),
    dcOffset: round(Math.abs(sum / count)),
    issues: [],
  };
  if (quality.durationMs < 3000) quality.issues.push("voice_reference_too_short");
  if (quality.durationMs > 30000) quality.issues.push("voice_reference_too_long");
  if (quality.rmsDbfs < -35) quality.issues.push("voice_reference_too_quiet");
  if (quality.rmsDbfs > -3) quality.issues.push("voice_reference_too_loud");
  if (quality.clippingRatio > 0.01) quality.issues.push("voice_reference_clipping");
  if (quality.silenceRatio > 0.6) quality.issues.push("voice_reference_too_silent");
  if (quality.dcOffset > 0.05) quality.issues.push("voice_reference_dc_offset");
  quality.accepted = quality.issues.length === 0;
  return quality;
}

function parsePcm16Wav(audio: Buffer) {
  if (audio.length < 44 || audio.toString("ascii", 0, 4) !== "RIFF" ||
    audio.toString("ascii", 8, 12) !== "WAVE") return null;
  let offset = 12;
  let format: { sampleRate: number; channels: number } | null = null;
  let data: Buffer | null = null;
  while (offset + 8 <= audio.length) {
    const id = audio.toString("ascii", offset, offset + 4);
    const size = audio.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > audio.length) return null;
    if (id === "fmt " && size >= 16) {
      if (audio.readUInt16LE(start) !== 1 || audio.readUInt16LE(start + 14) !== 16) {
        return null;
      }
      format = {
        channels: audio.readUInt16LE(start + 2),
        sampleRate: audio.readUInt32LE(start + 4),
      };
    }
    if (id === "data") data = audio.subarray(start, end);
    offset = end + (size % 2);
  }
  if (!format || !data || ![1, 2].includes(format.channels) ||
    ![16000, 24000, 44100, 48000].includes(format.sampleRate)) return null;
  const samples = new Int16Array(data.length / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = data.readInt16LE(index * 2);
  }
  return { ...format, samples };
}

function round(value: number) {
  return Math.round(value * 10000) / 10000;
}
