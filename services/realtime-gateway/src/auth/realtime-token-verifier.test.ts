import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyRealtimeToken } from "./realtime-token-verifier.js";

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

describe("realtime token verifier", () => {
  const valid=()=>({userId:"owner",sessionId:"session",planCode:"free",maxDurationSeconds:300,
    issuedAt:1,expiresAt:Math.floor(Date.now()/1000)+60});
  function signed(json:string){const payload=Buffer.from(json).toString("base64url");return `${payload}.${sign(payload,"secret")}`;}
  it.each(["{", "null", "[]", "1", JSON.stringify({userId:"owner"})])(
    "rejects malformed authenticated payloads without throwing (%s)", json=>{
      expect(()=>verifyRealtimeToken(signed(json),"secret")).not.toThrow();
      expect(verifyRealtimeToken(signed(json),"secret")).toBeNull();
    });
  it.each([{expiresAt:"9999999999"},{expiresAt:null},{issuedAt:-1},{maxDurationSeconds:0},
    {sessionId:""},{userId:[]},{planCode:""}])("rejects invalid admission envelope %j",patch=>{
      expect(verifyRealtimeToken(signed(JSON.stringify({...valid(),...patch})),"secret")).toBeNull();
    });
  it("refuses extra token components and non-ASCII signatures",()=>{
    const token=signed(JSON.stringify(valid()));
    expect(verifyRealtimeToken(token+".ignored","secret")).toBeNull();
    expect(verifyRealtimeToken(token.split(".")[0]+"."+"字".repeat(43),"secret")).toBeNull();
  });
  it("accepts valid self-contained tokens", () => {
    const payload = Buffer.from(
      JSON.stringify({
        userId: "user_1",
        sessionId: "sess_1",
        planCode: "free",
        maxDurationSeconds: 1800,
        issuedAt: 1,
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      }),
    ).toString("base64url");
    const token = `${payload}.${sign(payload, "secret")}`;

    expect(verifyRealtimeToken(token, "secret")?.sessionId).toBe("sess_1");
  });
});
