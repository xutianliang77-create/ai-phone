import { X509Certificate, createHash, verify as verifySignature } from "node:crypto";

export interface AppleIapTransactionPayload {
  originalTransactionId?: string;
  transactionId?: string;
  productId?: string;
  bundleId?: string;
  environment?: string;
  revocationDate?: number;
}

type AppleVerificationFailure = {
  ok: false;
  code: "apple_server_verification_required" | "payment_verification_failed";
  retryable?: boolean;
};

export type AppleIapVerificationResult =
  | {
      ok: true;
      source: "apple_jws";
      payload: AppleIapTransactionPayload;
    }
  | AppleVerificationFailure;

export type AppleJwsPayloadVerificationResult<T> =
  | { ok: true; payload: T }
  | AppleVerificationFailure;

export function verifyAppleIapSignedTransaction(input: {
  signedTransactionInfo?: string;
  transactionId: string;
  productId: string;
  bundleId?: string;
  environment?: string;
  rootCertSha256?: string;
  now?: Date;
}): AppleIapVerificationResult {
  const verified = verifyAppleJwsPayload<AppleIapTransactionPayload>({
    jws: input.signedTransactionInfo,
    rootCertSha256: input.rootCertSha256,
    now: input.now,
  });
  if (!verified.ok) return verified;
  const payload = verified.payload;
  if (
    payload.transactionId !== input.transactionId ||
    payload.productId !== input.productId ||
    payload.bundleId !== input.bundleId ||
    payload.environment !== input.environment ||
    payload.revocationDate !== undefined
  ) {
    return paymentFailed();
  }
  return { ok: true, source: "apple_jws", payload };
}

export function verifyAppleIapSignedTransactionFromEnv(input: {
  signedTransactionInfo?: string;
  transactionId: string;
  productId: string;
}) {
  return verifyAppleIapSignedTransaction({
    ...input,
    bundleId: process.env.APPLE_IAP_BUNDLE_ID,
    environment: process.env.APPLE_IAP_ENVIRONMENT,
    rootCertSha256: process.env.APPLE_IAP_ROOT_CERT_SHA256,
  });
}

export function verifyAppleJwsPayload<T extends object>(input: {
  jws?: string;
  rootCertSha256?: string;
  now?: Date;
}): AppleJwsPayloadVerificationResult<T> {
  const parsed = parseCompactJws<T>(input.jws);
  if (!parsed) return paymentFailed();
  if (!input.rootCertSha256) return appleConfigRequired();

  const certs = parseCertificateChain(parsed.header.x5c);
  if (certs.length === 0 || !verifyCertificateChain(certs, input.rootCertSha256, input.now)) {
    return paymentFailed();
  }
  if (!verifyJwsSignature(parsed.signingInput, parsed.signature, certs[0])) {
    return paymentFailed();
  }
  return { ok: true, payload: parsed.payload };
}

function parseCompactJws<T extends object>(value: string | undefined) {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = parseJsonPart<{ alg?: string; x5c?: unknown }>(headerPart);
  const payload = parseJsonPart<T>(payloadPart);
  const signature = decodeBase64Url(signaturePart);
  if (!header || header.alg !== "ES256" || !payload || !signature) return null;
  return {
    header,
    payload,
    signature,
    signingInput: `${headerPart}.${payloadPart}`,
  };
}

function parseCertificateChain(x5c: unknown) {
  if (!Array.isArray(x5c)) return [];
  try {
    return x5c
      .filter((item): item is string => typeof item === "string" && item.length > 0)
      .map((item) => new X509Certificate(toPemCertificate(item)));
  } catch {
    return [];
  }
}

function verifyCertificateChain(
  certs: X509Certificate[],
  rootCertSha256: string,
  now = new Date(),
) {
  if (!certs.every((cert) => certificateIsCurrent(cert, now))) return false;
  for (let index = 0; index < certs.length - 1; index += 1) {
    if (!certs[index].verify(certs[index + 1].publicKey)) return false;
  }
  return fingerprintSha256(certs[certs.length - 1]) === normalizeFingerprint(rootCertSha256);
}

function verifyJwsSignature(signingInput: string, signature: Buffer, leaf: X509Certificate) {
  if (signature.length !== 64) return false;
  return verifySignature(
    "sha256",
    Buffer.from(signingInput),
    { key: leaf.publicKey, dsaEncoding: "ieee-p1363" },
    signature,
  );
}

function certificateIsCurrent(cert: X509Certificate, now: Date) {
  return now >= new Date(cert.validFrom) && now <= new Date(cert.validTo);
}

function fingerprintSha256(cert: X509Certificate) {
  return createHash("sha256").update(cert.raw).digest("hex");
}

function normalizeFingerprint(value: string) {
  return value.replace(/[^a-fA-F0-9]/g, "").toLowerCase();
}

function parseJsonPart<T>(value: string | undefined) {
  const decoded = decodeBase64Url(value);
  if (!decoded) return null;
  try {
    return JSON.parse(decoded.toString("utf8")) as T;
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string | undefined) {
  if (!value) return null;
  try {
    return Buffer.from(value, "base64url");
  } catch {
    return null;
  }
}

function toPemCertificate(x5cValue: string) {
  const lines = x5cValue.match(/.{1,64}/g)?.join("\n") ?? x5cValue;
  return `-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----`;
}

function appleConfigRequired(): AppleVerificationFailure {
  return {
    ok: false,
    code: "apple_server_verification_required",
    retryable: true,
  };
}

function paymentFailed(): AppleVerificationFailure {
  return { ok: false, code: "payment_verification_failed" };
}
