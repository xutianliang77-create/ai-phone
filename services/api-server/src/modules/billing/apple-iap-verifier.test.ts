import { afterEach, describe, expect, it } from "vitest";
import { createAppleIapJwsFixture } from "../../../test-support/apple-iap-jws.js";
import { verifyAppleIapSignedTransaction } from "./apple-iap-verifier.js";

const cleanupTasks: Array<() => void> = [];

afterEach(() => {
  while (cleanupTasks.length > 0) cleanupTasks.pop()?.();
});

describe("verifyAppleIapSignedTransaction", () => {
  it("accepts a StoreKit signed transaction with a pinned root certificate", () => {
    const fixture = trackedFixture();
    const result = verifyAppleIapSignedTransaction({
      signedTransactionInfo: fixture.signedTransactionInfo,
      transactionId: fixture.transactionId,
      productId: fixture.productId,
      bundleId: fixture.bundleId,
      environment: fixture.environment,
      rootCertSha256: fixture.rootCertSha256,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    expect(result.source).toBe("apple_jws");
    expect(result.payload).toMatchObject({
      transactionId: fixture.transactionId,
      productId: fixture.productId,
      bundleId: fixture.bundleId,
      environment: fixture.environment,
    });
  });

  it("rejects StoreKit transactions for a different product", () => {
    const fixture = trackedFixture();
    const result = verifyAppleIapSignedTransaction({
      signedTransactionInfo: fixture.signedTransactionInfo,
      transactionId: fixture.transactionId,
      productId: "domestic_plus_monthly",
      bundleId: fixture.bundleId,
      environment: fixture.environment,
      rootCertSha256: fixture.rootCertSha256,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "payment_verification_failed",
    });
  });

  it("does not trust StoreKit JWS without Apple root certificate pinning", () => {
    const fixture = trackedFixture();
    const result = verifyAppleIapSignedTransaction({
      signedTransactionInfo: fixture.signedTransactionInfo,
      transactionId: fixture.transactionId,
      productId: fixture.productId,
      bundleId: fixture.bundleId,
      environment: fixture.environment,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "apple_server_verification_required",
      retryable: true,
    });
  });
});

function trackedFixture() {
  const fixture = createAppleIapJwsFixture();
  cleanupTasks.push(fixture.cleanup);
  return fixture;
}
