import type { AccountDto, PhoneLoginResponse } from "@translation/contracts";

const sessionKey = "wujie.enterprise.session.v1";

export interface EnterpriseSession {
  token: string;
  expiresAt: string;
  account: AccountDto;
  tenantId?: string;
}

export interface EnterpriseSessionStore {
  read(): EnterpriseSession | null;
  write(session: EnterpriseSession): void;
  clear(): void;
}

export function createSessionStore(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  now: () => number = Date.now,
): EnterpriseSessionStore {
  return {
    read() {
      const raw = storage.getItem(sessionKey);
      if (!raw) return null;
      try {
        const session = JSON.parse(raw) as unknown;
        if (!isSession(session) || Date.parse(session.expiresAt) <= now()) {
          storage.removeItem(sessionKey);
          return null;
        }
        return session;
      } catch {
        storage.removeItem(sessionKey);
        return null;
      }
    },
    write(session) {
      storage.setItem(sessionKey, JSON.stringify(session));
    },
    clear() {
      storage.removeItem(sessionKey);
    },
  };
}

export function sessionFromLogin(result: PhoneLoginResponse): EnterpriseSession {
  return {
    token: result.token,
    expiresAt: result.expiresAt,
    account: result.account,
  };
}

function isSession(value: unknown): value is EnterpriseSession {
  if (!value || typeof value !== "object") return false;
  if (!("token" in value) || typeof value.token !== "string" || !value.token) return false;
  if (!("expiresAt" in value) || typeof value.expiresAt !== "string") return false;
  if (!("account" in value) || !isAccount(value.account)) return false;
  return !("tenantId" in value) || value.tenantId === undefined ||
    typeof value.tenantId === "string";
}

function isAccount(value: unknown): value is AccountDto {
  return Boolean(value && typeof value === "object" && "id" in value &&
    "phoneMasked" in value && typeof value.id === "string" &&
    typeof value.phoneMasked === "string");
}
