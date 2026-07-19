import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  loadEnterpriseLeadPhoneKeyring,
  openEnterpriseLeadPhone,
  protectEnterpriseLeadImportRow,
} from "./enterprise-lead-phone.js";

describe("enterprise lead phone protection", () => {
  it("encrypts original/canonical numbers and hashes by tenant", () => {
    const secret = randomBytes(32).toString("base64url");
    const keyring = loadEnterpriseLeadPhoneKeyring({
      ENTERPRISE_MARKETING_PHONE_ACTIVE_KEY_ID: "key-1",
      ENTERPRISE_MARKETING_PHONE_KEYS_JSON: JSON.stringify({ "key-1": secret }),
      ENTERPRISE_MARKETING_PHONE_HASH_KEY: randomBytes(32).toString("base64url"),
    })!;
    const tenantId = randomUUID();
    const id = randomUUID();
    const row = { rowNumber: 1, phoneInput: "(415) 555-2671",
        phoneE164: "+14155552671", phoneHint: "+*******2671", countryCode: "US",
        attributes: {} };
    const protectedRow = protectEnterpriseLeadImportRow({ tenantId, id, keyring, row });
    expect(protectedRow.phoneE164Encrypted.toString()).not.toContain("14155552671");
    expect(openEnterpriseLeadPhone({ tenantId, id, field: "e164",
      encrypted: protectedRow.phoneE164Encrypted, keyring })).toBe("+14155552671");
    expect(() => openEnterpriseLeadPhone({ tenantId: randomUUID(), id, field: "e164",
      encrypted: protectedRow.phoneE164Encrypted, keyring })).toThrow();
  });
});
