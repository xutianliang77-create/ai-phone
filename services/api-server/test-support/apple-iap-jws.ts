import { execFileSync } from "node:child_process";
import { X509Certificate, createHash, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface AppleIapJwsFixture {
  transactionId: string;
  productId: string;
  bundleId: string;
  environment: string;
  signedTransactionInfo: string;
  rootCertSha256: string;
  signPayload: (payload: object) => string;
  cleanup: () => void;
}

export function createAppleIapJwsFixture(input: {
  transactionId?: string;
  productId?: string;
  bundleId?: string;
  environment?: string;
} = {}): AppleIapJwsFixture {
  const dir = mkdtempSync(join(tmpdir(), "apple-iap-jws-"));
  const transactionId = input.transactionId ?? "900000123456789";
  const productId = input.productId ?? "domestic_credits_60m";
  const bundleId = input.bundleId ?? "com.translation.mobile";
  const environment = input.environment ?? "Sandbox";

  createCertificateChain(dir);
  const rootCert = new X509Certificate(readFileSync(join(dir, "root.crt")));
  const header = {
    alg: "ES256",
    x5c: [
      pemBody(readFileSync(join(dir, "leaf.crt"), "utf8")),
      pemBody(readFileSync(join(dir, "root.crt"), "utf8")),
    ],
  };
  const payload = { transactionId, productId, bundleId, environment };
  const privateKey = readFileSync(join(dir, "leaf.key"));
  const signPayload = (nextPayload: object) => signJws(header, nextPayload, privateKey);
  const signedTransactionInfo = signPayload(payload);

  return {
    transactionId,
    productId,
    bundleId,
    environment,
    signedTransactionInfo,
    rootCertSha256: createHash("sha256").update(rootCert.raw).digest("hex"),
    signPayload,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function createCertificateChain(dir: string) {
  runOpenSsl(["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", "root.key"], dir);
  runOpenSsl([
    "req",
    "-x509",
    "-new",
    "-key",
    "root.key",
    "-sha256",
    "-days",
    "3",
    "-subj",
    "/CN=Test Apple Root",
    "-out",
    "root.crt",
  ], dir);
  runOpenSsl(["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", "leaf.key"], dir);
  runOpenSsl([
    "req",
    "-new",
    "-key",
    "leaf.key",
    "-subj",
    "/CN=Test Apple IAP Leaf",
    "-out",
    "leaf.csr",
  ], dir);
  writeFileSync(join(dir, "leaf.ext"), "basicConstraints=CA:FALSE\nkeyUsage=digitalSignature\n");
  runOpenSsl([
    "x509",
    "-req",
    "-in",
    "leaf.csr",
    "-CA",
    "root.crt",
    "-CAkey",
    "root.key",
    "-CAcreateserial",
    "-sha256",
    "-days",
    "3",
    "-extfile",
    "leaf.ext",
    "-out",
    "leaf.crt",
  ], dir);
}

function signJws(header: object, payload: object, privateKey: Buffer) {
  const signingInput = `${base64urlJson(header)}.${base64urlJson(payload)}`;
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${signature.toString("base64url")}`;
}

function base64urlJson(value: object) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function pemBody(pem: string) {
  return pem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
}

function runOpenSsl(args: string[], cwd: string) {
  execFileSync("openssl", args, { cwd, stdio: "ignore" });
}
