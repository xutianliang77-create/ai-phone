export interface GuestAuthResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    loginType: "guest";
  };
}
