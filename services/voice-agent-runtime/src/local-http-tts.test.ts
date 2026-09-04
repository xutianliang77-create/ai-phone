import { initializeLogger } from "@livekit/agents";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LocalHttpTTS } from "./local-http-tts.js";

initializeLogger({ pretty: false, level: "silent" });

describe("LocalHttpTTS", () => {
  it("preserves ordered PCM chunks and marks only the final frame final", async () => {
    const first = new Int16Array([1, -2, 3, -4]);
    const second = new Int16Array([5, -6, 7]);
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response([
      JSON.stringify({ type: "metadata", outputSampleRate: 24_000 }),
      audioEvent(1, first),
      audioEvent(2, second),
      JSON.stringify({ type: "final", audioDurationMs: 1 }),
      "",
    ].join("\n"), {
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
    }));
    const tts = new LocalHttpTTS({
      baseUrl: "http://tts.local/",
      apiKey: "tts-secret",
      language: "zh",
      model: "local/voxcpm2",
      voice: "default",
      timeoutMs: 1000,
      fetchFn,
    });

    const events = [];
    for await (const event of tts.synthesize("测试语音")) events.push(event);

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.final)).toEqual([false, true]);
    expect(events.map((event) => event.frame.sampleRate)).toEqual([24_000, 24_000]);
    expect(Array.from(events[0]!.frame.data)).toEqual(Array.from(first));
    expect(Array.from(events[1]!.frame.data)).toEqual(Array.from(second));
    const request = fetchFn.mock.calls[0]!;
    expect(request[0]).toBe("http://tts.local/tts/stream");
    expect(request[1]).toEqual(expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ authorization: "Bearer tts-secret" }),
    }));
    expect(JSON.parse(String(request[1]?.body))).toEqual(expect.objectContaining({
      text: "测试语音",
      language: "zh",
      speakerRole: "host",
    }));
    expect(JSON.parse(String(request[1]?.body))).not.toHaveProperty("voice");
  });

  it("writes opt-in exact-text WAV evidence and hashes without phone metadata", async () => {
    const evidenceDir = await mkdtemp(join(tmpdir(), "voice-tts-evidence-"));
    const first = new Int16Array([100, -100, 200, -200]);
    const second = new Int16Array([300, -300]);
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response([
      audioEvent(1, first),
      audioEvent(2, second),
      JSON.stringify({ type: "final" }),
      "",
    ].join("\n"), { status: 200 }));
    const text = "您好，我是经用户授权代为致电的AI助手。";
    try {
      const tts = new LocalHttpTTS({
        baseUrl: "http://tts.local",
        language: "zh",
        model: "local/voxcpm2",
        voice: "default",
        timeoutMs: 1000,
        fetchFn,
        evidenceDir,
      });
      for await (const _event of tts.synthesize(text)) { /* drain */ }

      const files = await readdir(evidenceDir);
      expect(files.filter((name) => name.endsWith(".wav"))).toHaveLength(1);
      expect(files.filter((name) => name.endsWith(".json"))).toHaveLength(1);
      const wav = await readFile(join(
        evidenceDir,
        files.find((name) => name.endsWith(".wav"))!,
      ));
      const manifest = JSON.parse(await readFile(join(
        evidenceDir,
        files.find((name) => name.endsWith(".json"))!,
      ), "utf8"));
      const expectedPcm = Buffer.concat([
        Buffer.from(first.buffer, first.byteOffset, first.byteLength),
        Buffer.from(second.buffer, second.byteOffset, second.byteLength),
      ]);

      expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
      expect(wav.subarray(44)).toEqual(expectedPcm);
      expect(manifest).toMatchObject({
        text,
        sampleRate: 24_000,
        channels: 1,
        pcmBytes: expectedPcm.length,
        wavSha256: createHash("sha256").update(wav).digest("hex"),
      });
      expect(JSON.stringify(manifest)).not.toMatch(/phone|callee|recipient/i);
    } finally {
      await rm(evidenceDir, { recursive: true, force: true });
    }
  });
});

function audioEvent(sequence: number, samples: Int16Array) {
  return JSON.stringify({
    type: "audio_chunk",
    format: "pcm16",
    sampleRate: 24_000,
    sequence,
    data: Buffer.from(
      samples.buffer,
      samples.byteOffset,
      samples.byteLength,
    ).toString("base64"),
  });
}
