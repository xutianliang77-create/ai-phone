import { z } from "zod";

const schema = z.object({
  v: z.literal(3),
  ticketId: z.string().uuid(),
  tenantId: z.string().uuid(),
  communicationSessionId: z.string().uuid(),
  policySnapshotId: z.string().uuid(),
  policyVersion: z.string().min(1).max(160),
  entitlementVersion: z.string().min(1).max(160),
  cellId: z.string().min(1).max(128),
  routeEpoch: z.number().int().positive(),
  generation: z.number().int().positive(),
  capability: z.literal("voice_agent_runtime"),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
}).strict();

export type SupportAgentTicket = z.infer<typeof schema> & { ticket: string };

export function parseSupportAgentTicket(value: string) {
  if (Buffer.byteLength(value) > 4_096) return null;
  const [encoded, signature, extra] = value.split(".");
  if (!encoded || !signature || extra) return null;
  try {
    const parsed = schema.safeParse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
    return parsed.success ? { ...parsed.data, ticket: value } : null;
  } catch { return null; }
}
