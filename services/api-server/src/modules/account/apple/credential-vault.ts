import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { text } from "./apple-validation.js";
import { AppleIdentityError } from "./apple-identity.js";

export interface SealedAppleCredential { version: 1; keyId: string; iv: string; ciphertext: string; tag: string }

/** Key ring is explicitly injected from Workers Secrets; never a default/development key. */
export class AppleCredentialVault {
  constructor(private readonly keys: ReadonlyMap<string, Uint8Array>, readonly activeKeyId: string,
    private readonly scope: string) {
    text(activeKeyId, 80); text(scope, 300);
    if (!keys.has(activeKeyId) || [...keys].some(([id, key]) => !id || key.byteLength !== 32)) {
      throw new AppleIdentityError("apple_vault_key_required");
    }
    this.keys = new Map([...keys].map(([id, key]) => [id, Uint8Array.from(key)]));
  }
  seal(identityKey: string, ownerId: string, refreshToken: string): SealedAppleCredential {
    text(refreshToken, 8192);
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.keys.get(this.activeKeyId)!, iv);
    cipher.setAAD(this.aad(identityKey, ownerId));
    const ciphertext = Buffer.concat([cipher.update(refreshToken, "utf8"), cipher.final()]);
    return { version: 1, keyId: this.activeKeyId, iv: iv.toString("base64url"), ciphertext: ciphertext.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url") };
  }
  open(identityKey: string, ownerId: string, sealed: SealedAppleCredential) {
    const key = this.keys.get(sealed?.keyId);
    if (!key || sealed.version !== 1 || sealed.iv?.length !== 16 || sealed.tag?.length !== 22 ||
      typeof sealed.ciphertext !== "string" || sealed.ciphertext.length > 12_000) {
      throw new AppleIdentityError("apple_credential_unavailable");
    }
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64url"));
      decipher.setAAD(this.aad(identityKey, ownerId)); decipher.setAuthTag(Buffer.from(sealed.tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64url")), decipher.final()]).toString("utf8");
    } catch { throw new AppleIdentityError("apple_credential_unavailable"); }
  }
  private aad(identityKey: string, ownerId: string) {
    return Buffer.from(JSON.stringify({ purpose: "apple-refresh-v1", scope: this.scope,
      identityKey: text(identityKey), ownerId: text(ownerId, 160) }));
  }
}
