import { describe, expect, it } from "vitest";
import { signGatewayStopReceipt, verifyGatewayStopReceipt } from "./gateway-stop-receipt.js";

const key = "fixture-only-32-byte-gateway-key-material";
const input = { sessionId: "s1", userId: "u1", billableSeconds: 12, providerClosed: true as const, issuedAt: 1000 };
describe("purpose-bound authoritative stop evidence", () => {
  it("binds owner, session and meter without granting further inference", () => {
    const token = signGatewayStopReceipt(input, key);
    expect(verifyGatewayStopReceipt(token, key, input, 2000)).toMatchObject(input);
    expect(verifyGatewayStopReceipt(token, key, { ...input, userId: "u2" }, 2000)).toBeNull();
    expect(verifyGatewayStopReceipt(token, key, { ...input, sessionId: "s2" }, 2000)).toBeNull();
    expect(verifyGatewayStopReceipt(token, "different-fixture-32-byte-secret-key", input, 2000)).toBeNull();
  });
  it("rejects tampered seconds, JWT-purpose substitution and unconfirmed close", () => {
    const token = signGatewayStopReceipt(input, key);
    const parts = token.split(".");
    parts[1] = Buffer.from(JSON.stringify({ ...input, billableSeconds: 0 })).toString("base64url");
    expect(verifyGatewayStopReceipt(parts.join("."), key, input, 2000)).toBeNull();
    expect(verifyGatewayStopReceipt(`eyJhbGciOiJIUzI1NiJ9.${parts[1]}.${parts[2]}`, key, input, 2000)).toBeNull();
    expect(() => signGatewayStopReceipt({ ...input, providerClosed: false as true }, key)).toThrow();
    expect(() => signGatewayStopReceipt(input, "dev-secret")).toThrow();
  });
  it("allows delayed submission only as evidence of the same completed action", () => {
    const token = signGatewayStopReceipt(input, key);
    expect(verifyGatewayStopReceipt(token, key, input, 100000000)).not.toBeNull();
    expect(verifyGatewayStopReceipt(signGatewayStopReceipt({ ...input, issuedAt: 50000 }, key), key, input, 1000)).toBeNull();
  });
});
