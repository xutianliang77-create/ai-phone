import {describe,it,expect} from "vitest";
import type {RealtimeEnv} from "../config/env.js";
import {publicGatewayRuntimeBootstrapIssue,publicGatewayRuntimeOptions} from "./public-runtime-bootstrap.js";

const base=(patch:Partial<RealtimeEnv>={})=>({publicDeploymentId:"public-test",publicRuntimeEnabled:true,
  publicCredentialAccessSecret:"p".repeat(32),internalApiSecret:"i".repeat(32),realtimeTokenSecret:"r".repeat(32),...patch} as RealtimeEnv);
describe("explicit public runtime bootstrap",()=>{
  it("remains default-off until deployment, enablement and an independent access secret all match",()=>{
    expect(publicGatewayRuntimeBootstrapIssue(base({publicRuntimeEnabled:false}))).toBe("public_runtime_disabled");
    expect(publicGatewayRuntimeBootstrapIssue(base({publicDeploymentId:undefined}))).toBe("public_deployment_not_configured");
    expect(publicGatewayRuntimeBootstrapIssue(base({publicCredentialAccessSecret:"short"}))).toBe("public_credential_access_required");
    expect(publicGatewayRuntimeBootstrapIssue(base({publicCredentialAccessSecret:"i".repeat(32)}))).toBe("public_credential_access_must_be_independent");
  });
  it("exposes no provider key or legacy endpoint when the explicit public bridge is eligible",()=>{
    const options=publicGatewayRuntimeOptions(base());expect(options).toEqual({credentialAccessSecret:"p".repeat(32)});
    expect(publicGatewayRuntimeOptions(base({publicRuntimeEnabled:false}))).toBeUndefined();
  });
});
