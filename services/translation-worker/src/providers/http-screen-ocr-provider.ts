import type { VideoFrame } from "@livekit/rtc-node";
import { z } from "zod";
import type { EnterpriseScreenOcrBlock } from
  "../livekit-agent/enterprise-screen-ocr-runtime-client.js";

const responseSchema = z.object({
  status: z.literal("ready"),
  fingerprint: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/),
  blocks: z.array(z.object({
    rect: z.object({
      left: z.number().min(0).max(1), top: z.number().min(0).max(1),
      width: z.number().positive().max(1), height: z.number().positive().max(1),
    }).strict(),
    sourceLanguage: z.enum(["zh", "en"]),
    sourceText: z.string().min(1).max(4_000),
    translatedText: z.string().min(1).max(4_000),
  }).strict()).max(100),
}).strict();

export class HttpScreenOcrProvider {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: {
    endpoint: string;
    apiKey: string;
    timeoutMs: number;
    fetchFn?: typeof fetch;
  }) { this.fetchFn = options.fetchFn ?? fetch; }

  async recognize(input: {
    frame: VideoFrame;
    targetLanguage: "zh" | "en";
  }): Promise<{ fingerprint: string; blocks: EnterpriseScreenOcrBlock[] }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchFn(this.options.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json",
          authorization: `Bearer ${this.options.apiKey}` },
        body: JSON.stringify({
          image: { encoding: "rgba", width: input.frame.width,
            height: input.frame.height,
            data: Buffer.from(input.frame.data).toString("base64") },
          targetLanguage: input.targetLanguage,
          output: { coordinates: "normalized", translate: true },
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new ScreenOcrProviderError(
        response.status === 429 ? "screen_ocr_provider_rate_limited" :
          "screen_ocr_provider_unavailable",
      );
      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success || parsed.data.blocks.some((block) =>
        block.rect.left + block.rect.width > 1.000001 ||
        block.rect.top + block.rect.height > 1.000001 ||
        !block.sourceText.trim() || !block.translatedText.trim()
      ) || Buffer.byteLength(JSON.stringify(parsed.data.blocks)) > 9_000) {
        throw new ScreenOcrProviderError("screen_ocr_provider_protocol_invalid");
      }
      return { fingerprint: parsed.data.fingerprint,
        blocks: parsed.data.blocks.map((block) => ({ ...block,
          sourceText: block.sourceText.trim(),
          translatedText: block.translatedText.trim() })) };
    } catch (error) {
      if (error instanceof ScreenOcrProviderError) throw error;
      throw new ScreenOcrProviderError(error instanceof Error &&
        error.name === "AbortError" ? "screen_ocr_provider_timeout" :
        "screen_ocr_provider_failed");
    } finally { clearTimeout(timer); }
  }
}

export function createEnvironmentScreenOcrProvider() {
  if (process.env.ENTERPRISE_SCREEN_OCR_ENABLED !== "true" ||
    process.env.ENTERPRISE_SCREEN_OCR_PROVIDER !== "http") return null;
  const raw = process.env.ENTERPRISE_SCREEN_OCR_ENDPOINT?.trim();
  const apiKey = process.env.ENTERPRISE_SCREEN_OCR_API_KEY?.trim();
  try {
    const endpoint = new URL(raw ?? "");
    if (endpoint.protocol !== "https:" || !apiKey) return null;
    return new HttpScreenOcrProvider({ endpoint: endpoint.toString(), apiKey,
      timeoutMs: integer("ENTERPRISE_SCREEN_OCR_TIMEOUT_MS", 10_000, 1_000, 30_000) });
  } catch { return null; }
}

export class ScreenOcrProviderError extends Error {
  constructor(readonly reasonCode: string) { super(reasonCode); }
}

function integer(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= minimum && value <= maximum
    ? value : fallback;
}
