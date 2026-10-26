import { createHash, createPublicKey, timingSafeEqual, verify, type JsonWebKey } from "node:crypto";

import { repositoryRequestHash } from "../../../infrastructure/storage/repository-command-identity.js";
import { digest, integer, text } from "./apple-validation.js";

export const appleIssuer = "https://appleid.apple.com";
export const appleJwksUrl = `${appleIssuer}/auth/keys`;
export class AppleIdentityError extends Error {
  constructor(readonly code: string) { super(code); }
}
export interface VerifiedAppleIdentity {
  issuer: typeof appleIssuer; audience: string; scope: string; subjectHash: string;
  identityKey: string; verifiedAtMs: number; expiresMs: number;
}
interface AppleJwk extends JsonWebKey { kid?: string; use?: string; alg?: string }
interface Claims { iss?: unknown; aud?: unknown; sub?: unknown; nonce?: unknown; exp?: unknown; iat?: unknown }

/** Public signing keys only. Token claims, nonce, scope, revocation and account
 * authorization are still verified for every request. */
export class AppleJwksCache {
  private cached:{keys:AppleJwk[];expiresMs:number}|null=null;
  private pending:Promise<AppleJwk[]>|null=null;
  async read(fetchFn:typeof fetch,nowMs:number,refresh:boolean):Promise<AppleJwk[]> {
    if(!refresh&&this.cached&&this.cached.expiresMs>nowMs)return this.cached.keys;
    if(this.pending)return this.pending;
    const pending=(async()=>{
      const response=await fetchFn(appleJwksUrl,{redirect:"error",signal:AbortSignal.timeout(8_000)});
      if(!response.ok)throw new AppleIdentityError("apple_jwks_unavailable");
      const value=await boundedJson(response) as {keys?:AppleJwk[]};
      if(!value||!Array.isArray(value.keys)||value.keys.length<1||value.keys.length>16||
          value.keys.some(k=>!k||typeof k.kid!=="string"))throw new AppleIdentityError("apple_invalid_jwks");
      const keys=value.keys.map(k=>({...k}));
      this.cached={keys,expiresMs:nowMs+3_600_000};return keys;
    })();
    this.pending=pending;
    try{return await pending;}finally{if(this.pending===pending)this.pending=null;}
  }
}
const publicAppleJwks=new AppleJwksCache();

export function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function sameSecret(left: string, right: string) {
  return timingSafeEqual(Buffer.from(sha256(left), "hex"), Buffer.from(sha256(right), "hex"));
}

export async function boundedJson(response: Response, maximumBytes = 65_536): Promise<unknown> {
  if (!response.body) throw new AppleIdentityError("apple_empty_response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > maximumBytes) throw new AppleIdentityError("apple_response_too_large");
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

export class AppleIdentityVerifier {
  readonly scope: string;
  constructor(readonly clientId: string, teamId: string, private readonly fetchFn: typeof fetch = fetch,
      private readonly publicKeys:AppleJwksCache=fetchFn===fetch?publicAppleJwks:new AppleJwksCache()) {
    text(clientId, 160); text(teamId, 80); this.scope = `${teamId}:${clientId}`;
  }

  async verifyToken(token: string, expectedNonce: string | null, nowMs: number): Promise<VerifiedAppleIdentity> {
    integer(nowMs); text(token, 16_384);
    const parts = token.split(".");
    if (parts.length !== 3) throw new AppleIdentityError("apple_invalid_jwt");
    const header = decodeObject(parts[0]) as { alg?: unknown; kid?: unknown; crit?: unknown; jku?: unknown };
    if (!["RS256", "ES256"].includes(String(header.alg)) || typeof header.kid !== "string" ||
      header.kid.length > 160 || header.crit !== undefined || header.jku !== undefined) {
      throw new AppleIdentityError("apple_invalid_jwt_header");
    }
    let keys = await this.keys(nowMs, false);
    let key = keys.find(k => k.kid === header.kid);
    if (!key) { keys = await this.keys(nowMs, true); key = keys.find(k => k.kid === header.kid); }
    if (!key || key.use !== "sig" || key.alg !== header.alg ||
      (header.alg === "RS256" && key.kty !== "RSA") ||
      (header.alg === "ES256" && (key.kty !== "EC" || key.crv !== "P-256"))) {
      throw new AppleIdentityError("apple_signing_key_unavailable");
    }
    let valid = false;
    try {
      // Workers rejects a KeyObject nested in verify options. Preserve the
      // verified JWK and signature algorithm, using its SPKI representation.
      const publicKey = createPublicKey({ key, format: "jwk" }).export({ type: "spki", format: "pem" });
      valid = verify("sha256", Buffer.from(`${parts[0]}.${parts[1]}`),
        { key: publicKey, ...(header.alg === "ES256" ? { dsaEncoding: "ieee-p1363" as const } : {}) }, decodeBytes(parts[2]));
    } catch { throw new AppleIdentityError("apple_invalid_signature"); }
    if (!valid) throw new AppleIdentityError("apple_invalid_signature");
    const claims = decodeObject(parts[1]) as Claims;
    if (claims.iss !== appleIssuer || claims.aud !== this.clientId || typeof claims.sub !== "string" ||
      !claims.sub.length || claims.sub.length > 256 || !Number.isSafeInteger(claims.exp) ||
      !Number.isSafeInteger(claims.iat) || Number(claims.exp) * 1000 <= nowMs ||
      Number(claims.iat) * 1000 > nowMs + 60_000 || Number(claims.iat) >= Number(claims.exp)) {
      throw new AppleIdentityError("apple_invalid_claims");
    }
    if (expectedNonce !== null && (typeof claims.nonce !== "string" || !sameSecret(claims.nonce, expectedNonce))) {
      throw new AppleIdentityError("apple_nonce_mismatch");
    }
    const subjectHash = sha256(`apple-subject:${claims.sub}`);
    return { issuer: appleIssuer, audience: this.clientId, scope: this.scope, subjectHash: digest(subjectHash),
      identityKey: repositoryRequestHash({ provider: "apple", issuer: appleIssuer, scope: this.scope, subjectHash }),
      verifiedAtMs: nowMs, expiresMs: integer(Number(claims.exp) * 1000, 1) };
  }

  private async keys(nowMs: number, refresh: boolean) {
    return this.publicKeys.read(this.fetchFn,nowMs,refresh);
  }
}
function decodeBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new AppleIdentityError("apple_invalid_base64url");
  const result = Buffer.from(value, "base64url");
  if (result.toString("base64url") !== value) throw new AppleIdentityError("apple_invalid_base64url");
  return result;
}
function decodeObject(value: string): Record<string, unknown> {
  try {
    const decoded: unknown = JSON.parse(decodeBytes(value).toString("utf8"));
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw Error();
    return decoded as Record<string, unknown>;
  } catch { throw new AppleIdentityError("apple_invalid_jwt_json"); }
}
