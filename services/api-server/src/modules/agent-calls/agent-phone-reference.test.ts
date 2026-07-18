import { describe, expect, it } from "vitest";
import {
  isAgentPhoneReference,
  loadAgentPhoneReferenceKeyring,
  openAgentPhoneReference,
  protectAgentCallPrimaryPayload,
  sealAgentPhoneReference,
  type AgentPhoneReferenceKeyring,
} from "./agent-phone-reference.js";

describe("Agent phone references", () => {
  it("seals deterministically for retry and binds decryption to owner and draft", () => {
    const keyring = testKeyring();
    const input = { userId: "user-a", draftId: "draft-a", phone: "13800138000" };
    const first = sealAgentPhoneReference(input, keyring);
    expect(sealAgentPhoneReference(input, keyring)).toBe(first);
    expect(isAgentPhoneReference(first)).toBe(true);
    expect(first).not.toContain(input.phone);
    expect(openAgentPhoneReference({
      userId: input.userId, draftId: input.draftId, reference: first,
    }, keyring)).toBe(input.phone);
    expect(() => openAgentPhoneReference({
      userId: "user-b", draftId: input.draftId, reference: first,
    }, keyring)).toThrow(/Invalid Agent phone reference/);
  });

  it("reads old key IDs while writing only with the active rotation key", () => {
    const oldKeyring = testKeyring("old");
    const input = { userId: "user-a", draftId: "draft-a", phone: "+14155552671" };
    const oldReference = sealAgentPhoneReference(input, oldKeyring);
    const rotated = testKeyring("next");
    expect(sealAgentPhoneReference(input, rotated)).toMatch(/^aph1\.next\./);
    expect(openAgentPhoneReference({ ...input, reference: oldReference }, rotated))
      .toBe(input.phone);
  });

  it("removes plaintext from primary payloads", () => {
    const previousActive = process.env.AGENT_PHONE_REFERENCE_ACTIVE_KEY_ID;
    const previousKeys = process.env.AGENT_PHONE_REFERENCE_KEYS_JSON;
    process.env.AGENT_PHONE_REFERENCE_ACTIVE_KEY_ID = "test";
    process.env.AGENT_PHONE_REFERENCE_KEYS_JSON = JSON.stringify({
      test: Buffer.alloc(32, 7).toString("base64url"),
    });
    try {
      const payload = protectAgentCallPrimaryPayload({
        id: "draft-a", userId: "user-a", targetPhone: "13800138000",
        status: "draft",
      });
      expect(payload.targetPhone).toBeUndefined();
      expect(payload.targetPhoneReference).toMatch(/^aph1\.test\./);
      expect(JSON.stringify(payload)).not.toContain("13800138000");
    } finally {
      restore("AGENT_PHONE_REFERENCE_ACTIVE_KEY_ID", previousActive);
      restore("AGENT_PHONE_REFERENCE_KEYS_JSON", previousKeys);
    }
  });

  it("fails closed on missing or malformed key configuration", () => {
    expect(() => loadAgentPhoneReferenceKeyring({
      AGENT_PHONE_REFERENCE_ACTIVE_KEY_ID: "active",
      AGENT_PHONE_REFERENCE_KEYS_JSON: "{}",
    })).toThrow(/active key is unavailable/);
    expect(() => loadAgentPhoneReferenceKeyring({
      AGENT_PHONE_REFERENCE_ACTIVE_KEY_ID: "active",
      AGENT_PHONE_REFERENCE_KEYS_JSON: JSON.stringify({ active: "short" }),
    })).toThrow(/Invalid Agent phone reference/);
  });
});

function testKeyring(activeKeyId = "old"): AgentPhoneReferenceKeyring {
  return {
    activeKeyId,
    keys: new Map([
      ["old", Buffer.alloc(32, 1)],
      ["next", Buffer.alloc(32, 2)],
    ]),
  };
}

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
