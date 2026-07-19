import { z } from "zod";

const payloadSchema = z.object({
  v: z.literal(1),
  callId: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(128),
  roomName: z.string().min(1).max(256),
  agentName: z.string().min(1).max(64),
  generation: z.number().int().positive(),
  nonce: z.string().min(1).max(64),
  iat: z.number().int().positive(),
  exp: z.number().int().positive(),
}).strict();

export type VoiceAgentDispatchTicket = z.infer<typeof payloadSchema> & {
  ticket: string;
};

export function parseVoiceAgentDispatchTicket(value: string) {
  if (Buffer.byteLength(value) > 4096) return null;
  const [encoded, signature, extra] = value.split(".");
  if (!encoded || !signature || extra) return null;
  try {
    const parsed = payloadSchema.safeParse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
    return parsed.success ? { ...parsed.data, ticket: value } : null;
  } catch {
    return null;
  }
}
