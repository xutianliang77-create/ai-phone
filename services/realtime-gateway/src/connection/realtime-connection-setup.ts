import type {IncomingMessage} from "node:http";
import type WebSocket from "ws";
import type {createRealtimeServerRuntime} from "./realtime-server-runtime.js";
import {admitRealtimeConnection} from "./realtime-connection-admission.js";
import {configureRealtimeProvider,reportProviderSetupFailure} from "./realtime-provider-setup.js";
import {coreDependencyFailureStage} from "./gateway-dependency-readiness.js";
import {ProviderRouter} from "../providers/provider-router.js";
import {createRealtimeTtsOutputQueue} from "../tts/realtime-tts-output-factory.js";
import {openConfiguredPublicConnection,type PublicGatewayRuntimeOptions} from "./configured-public-connection.js";
export async function setupRealtimeConnection(runtime:ReturnType<typeof createRealtimeServerRuntime>,ws:WebSocket,request:IncomingMessage,publicRuntime?:PublicGatewayRuntimeOptions){
  if(runtime.env.publicDeploymentId&&publicRuntime)return openConfiguredPublicConnection(runtime.env,ws,request,publicRuntime);
  const attachment=admitRealtimeConnection(ws,request,runtime.env);if(!attachment)return null;
  const {session,generation}=attachment;let stage:"provider"|"asr"|"translation"="provider";
  try{
    const failure=coreDependencyFailureStage(runtime.dependencyReadiness.readiness());if(failure){stage=failure;throw Error("dependency");}
    const provider=new ProviderRouter().selectProvider(runtime.env,session.claims);await configureRealtimeProvider(provider,runtime.env,session);
    return {...attachment,provider,ttsOutputQueue:createRealtimeTtsOutputQueue(runtime.env,session),sessionEventSink:runtime.sessionEventSink,
      markStarted:()=>{},publicConnection:false,checkpointDisconnect:undefined,
      retainPublicRecovery:undefined,releaseRetainedRecovery:undefined,publicRecoveryConnection:false,recoveryBridge:undefined};
  }catch{await reportProviderSetupFailure(runtime,ws,session,generation,stage);return null;}
}
