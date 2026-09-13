import {describe,it,expect} from "vitest";
import {publicGatewayCredentialAccessFromEnvironment} from "./public-runtime-bootstrap.js";

const base=(patch:Record<string,string|undefined>={})=>({API_RESULT_SYNC_DEPLOYMENT_ID:"public-test",PUBLIC_RUNTIME_ENABLED:"true",
  PUBLIC_GATEWAY_CREDENTIAL_ACCESS_SECRET:"p".repeat(32),INTERNAL_API_SECRET:"i".repeat(32),REALTIME_TOKEN_SECRET:"r".repeat(32),...patch});
describe("API public credential-material bootstrap",()=>{
  it("remains off unless explicitly enabled",()=>expect(publicGatewayCredentialAccessFromEnvironment(base({PUBLIC_RUNTIME_ENABLED:"false"}))).toBeUndefined());
  it.each([{"API_RESULT_SYNC_DEPLOYMENT_ID":""},{PUBLIC_GATEWAY_CREDENTIAL_ACCESS_SECRET:"short"},{PUBLIC_GATEWAY_CREDENTIAL_ACCESS_SECRET:"i".repeat(32)},{PUBLIC_GATEWAY_CREDENTIAL_ACCESS_SECRET:"r".repeat(32)}])(
    "rejects incomplete or reused public runtime bootstrap %j",patch=>expect(()=>publicGatewayCredentialAccessFromEnvironment(base(patch))).toThrow());
  it("passes only the independent material-access secret to route registration",()=>expect(publicGatewayCredentialAccessFromEnvironment(base())).toEqual({secret:"p".repeat(32)}));
});
