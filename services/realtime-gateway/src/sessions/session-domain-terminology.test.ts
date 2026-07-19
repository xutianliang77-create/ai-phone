import { describe, expect, it } from "vitest";
import type { RealtimeEnv } from "../config/env.js";
import type { RealtimeSession } from "./realtime-session.js";
import { domainLexiconPacksForSession } from "./session-domain-terminology.js";

describe("session domain terminology", () => {
  it("uses the packs signed into this session", () => {
    expect(domainLexiconPacksForSession(
      session(["product", "medical"]),
      env(["business"]),
    )).toEqual(["product", "medical"]);
  });

  it("keeps the server default for older clients", () => {
    expect(domainLexiconPacksForSession(
      session(),
      env(["product", "technology"]),
    )).toEqual(["product", "technology"]);
  });
});

function session(domainLexiconPacks?: RealtimeSession["claims"]["domainLexiconPacks"]): RealtimeSession {
  return {
    id: "sess_1",
    userId: "user_1",
    claims: {
      userId: "user_1",
      sessionId: "sess_1",
      sourceLanguage: "zh",
      targetLanguage: "en",
      voiceOutput: false,
      planCode: "free",
      domainLexiconPacks,
      maxDurationSeconds: 1800,
      issuedAt: 1,
      expiresAt: 2,
    },
    status: "active",
    startedAt: 1,
    accumulatedActiveMs: 0,
    connectionGeneration: 1,
    billableSeconds: 0,
  };
}

function env(domainLexiconPacks: RealtimeEnv["domainLexiconPacks"]) {
  return { domainLexiconPacks } as RealtimeEnv;
}
