import type {
  CallTtsAudioChunk,
  CallTtsAudioSink,
} from "./types.js";

export async function playTtsAudioStream(
  sink: CallTtsAudioSink,
  input: Parameters<CallTtsAudioSink["play"]>[0],
  audioStream: AsyncIterable<CallTtsAudioChunk>,
) {
  if (sink.playStream) return sink.playStream({ ...input, audioStream });
  let expectedSequence = 1;
  let sampleRate: 16000 | 24000 | undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of audioStream) {
    if (input.signal.aborted) {
      throw input.signal.reason ?? new Error("TTS playback stream aborted");
    }
    if (chunk.sequence !== expectedSequence) {
      throw new Error(`TTS playback sequence gap: expected ${expectedSequence}`);
    }
    expectedSequence += 1;
    if (sampleRate && sampleRate !== chunk.audio.sampleRate) {
      throw new Error("TTS playback sample rate changed");
    }
    sampleRate = chunk.audio.sampleRate;
    chunks.push(Buffer.from(chunk.audio.data, "base64"));
  }
  if (!sampleRate || chunks.length === 0) {
    throw new Error("TTS playback stream ended without audio");
  }
  return sink.play({
    ...input,
    speech: {
      ...input.speech,
      audio: {
        format: "pcm16",
        sampleRate,
        data: Buffer.concat(chunks).toString("base64"),
      },
    },
  });
}
