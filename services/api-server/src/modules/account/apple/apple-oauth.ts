import { createPrivateKey, sign } from "node:crypto";

import { integer, text } from "./apple-validation.js";
import { appleIssuer, AppleIdentityError, boundedJson } from "./apple-identity.js";

export interface AppleTokenResponse { idToken: string; refreshToken?: string }
export function appleClientSecret(input: { teamId: string; clientId: string; keyId: string; privateKeyPem: string }, nowMs: number) {
  text(input.teamId, 80); text(input.clientId, 160); text(input.keyId, 80); integer(nowMs);
  const key = createPrivateKey(input.privateKeyPem);
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new AppleIdentityError("apple_client_signing_key_invalid");
  }
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: input.keyId })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: input.teamId, sub: input.clientId, aud: appleIssuer,
    iat: Math.floor(nowMs / 1000), exp: Math.floor(nowMs / 1000) + 300 })).toString("base64url");
  const body = `${header}.${payload}`;
  // Keep the P-256 validation above; Workers accepts PEM in sign options but
  // rejects a nested PrivateKeyObject. No key material leaves this function.
  return `${body}.${sign("sha256", Buffer.from(body), { key: input.privateKeyPem, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

/** No retry of one-use authorization codes. Callers persist intent before invoking this port. */
export class AppleOAuthClient {
  constructor(readonly clientId: string, private readonly clientSecret: () => Promise<string>,
    private readonly fetchFn: typeof fetch = fetch) { text(clientId, 160); }

  exchange(code: string) { return this.token("authorization_code", "code", text(code, 2048)); }
  refresh(refreshToken: string) { return this.token("refresh_token", "refresh_token", text(refreshToken, 8192)); }

  async revoke(refreshToken: string) {
    const response = await this.request("/auth/revoke", new URLSearchParams({ token: text(refreshToken, 8192), token_type_hint: "refresh_token" }));
    await response.body?.cancel();
  }
  private async token(grantType: string, field: string, value: string): Promise<AppleTokenResponse> {
    const response = await this.request("/auth/token", new URLSearchParams({ grant_type: grantType, [field]: value }));
    let body: unknown;
    try { body = await boundedJson(response, 32_768); } catch { throw new AppleIdentityError("apple_oauth_uncertain"); }
    const v = body as { id_token?: unknown; refresh_token?: unknown };
    if (!v || typeof v.id_token !== "string" || v.id_token.length > 16_384 ||
      (v.refresh_token !== undefined && (typeof v.refresh_token !== "string" || v.refresh_token.length > 8192))) {
      throw new AppleIdentityError("apple_oauth_uncertain");
    }
    return { idToken: v.id_token, ...(typeof v.refresh_token === "string" ? { refreshToken: v.refresh_token } : {}) };
  }
  private async request(path: "/auth/token" | "/auth/revoke", body: URLSearchParams) {
    body.set("client_id", this.clientId); body.set("client_secret", await this.clientSecret());
    let response: Response;
    try {
      response = await this.fetchFn(`${appleIssuer}${path}`, { method: "POST", redirect: "error",
        headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(8_000) });
    } catch { throw new AppleIdentityError("apple_oauth_uncertain"); }
    if (!response.ok) {
      // Never expose token bodies, key material or Apple's raw response through an error.
      let error: unknown;
      try { error = (await boundedJson(response, 8192) as { error?: unknown })?.error; } catch { /* unknown outcome */ }
      throw new AppleIdentityError(error === "invalid_grant" ? "apple_credential_revoked" :
        error === "invalid_client" ? "apple_client_misconfigured" : "apple_oauth_uncertain");
    }
    return response;
  }
}
