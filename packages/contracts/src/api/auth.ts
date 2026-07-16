export interface GuestAuthResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    loginType: "guest";
  };
}

export interface AccountDto {
  id: string;
  phoneMasked: string;
  status: "active" | "deletion_requested" | "deleted";
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  deletionRequestedAt?: string;
}

export interface PhoneCodeRequestResponse {
  challengeId: string;
  phoneMasked: string;
  expiresAt: string;
  debugCode?: string;
}

export interface PhoneLoginResponse {
  token: string;
  expiresAt: string;
  account: AccountDto;
}
