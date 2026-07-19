import { expect, it } from "vitest";
import { BoundedTtsAudioStream } from "./tts-audio-stream.js";

it("broadcasts ordered chunks to every subscriber", async () => {
  const source = new BoundedTtsAudioStream(2);
  const first = collect(source.subscribe());
  const second = collect(source.subscribe());

  await source.publish(chunk(1));
  await source.publish(chunk(2));
  source.complete();

  expect(await first).toEqual([1, 2]);
  expect(await second).toEqual([1, 2]);
});

it("releases a blocked producer when a subscriber is cancelled", async () => {
  const source = new BoundedTtsAudioStream(1);
  const iterator = source.subscribe()[Symbol.asyncIterator]();
  await source.publish(chunk(1));
  const blocked = source.publish(chunk(2));

  await iterator.return?.();

  await expect(blocked).resolves.toBeUndefined();
});

async function collect(stream: AsyncIterable<ReturnType<typeof chunk>>) {
  const sequences: number[] = [];
  for await (const value of stream) sequences.push(value.sequence);
  return sequences;
}

function chunk(sequence: number) {
  return {
    sequence,
    audio: {
      format: "pcm16" as const,
      sampleRate: 24000 as const,
      data: "AAE=",
    },
  };
}
