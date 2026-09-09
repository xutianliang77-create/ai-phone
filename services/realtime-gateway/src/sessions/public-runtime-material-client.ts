import {createHash,randomUUID} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {publicRuntimeTokenBinding,matchesPublicAdmissionReceipt,type PublicAdmissionQuery,type RealtimeTokenClaims} from "@translation/contracts";
import type {ConfiguredPublicSessionOptions} from "../providers/configured-public-session.js";
import type {SessionEventSink} from "./session-event-sink.js";
type Snapshot=ConfiguredPublicSessionOptions["snapshot"];
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==="object"&&!Array.isArray(v);
function canonical(v:any):string{if(Array.isArray(v))return `[${v.map(canonical).join(",")}]`;if(object(v))return `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;return JSON.stringify(v);}
const hash=(v:unknown)=>createHash("sha256").update(canonical(v)).digest("hex");
export function createPublicRuntimeMaterialClient(sink:SessionEventSink,claims:RealtimeTokenClaims,deploymentId:string,gatewayCredential:string){
  const token=structuredClone(claims),binding=publicRuntimeTokenBinding(token,deploymentId);
  if(!binding||!sink.configuration||!sink.credentials)throw Error("public_runtime_material_not_bound");
  const configuration=sink.configuration.bind(sink),credentials=sink.credentials.bind(sink);
  const query=(purpose:PublicAdmissionQuery["purpose"]):PublicAdmissionQuery=>({...binding,contractVersion:1,requestId:randomUUID(),purpose,
    sessionId:token.sessionId,ownerId:token.userId,modelPolicyRevision:token.processing!.modelPolicyRevision,grantRef:token.processing!.publicGrantRef!});
  let snapshot:Snapshot|undefined;
  return {
    async configuration(signal?:AbortSignal){
      const q=query("connect"),value=await configuration(q,signal);
      if(!object(value)||Object.keys(value).length!==3||!matchesPublicAdmissionReceipt(value.receipt,q)||!object(value.configuration)||
        !isDeepStrictEqual(value.authorization,token.processing))throw Error("public_runtime_configuration_mismatch");
      const c=value.configuration;
      if(Object.keys(c).length!==7||c.schemaVersion!==1||c.deploymentId!==deploymentId||c.configurationRevision!==binding.configurationRevision||
        c.configurationHash!==binding.configurationHash||c.modelPolicyRevision!==token.processing!.modelPolicyRevision||
        !isDeepStrictEqual(c.executionPlan,token.processing!.executionPlan)||!object(c.components)||
        hash({schemaVersion:c.schemaVersion,deploymentId:c.deploymentId,configurationRevision:c.configurationRevision,components:c.components})!==binding.configurationHash)throw Error("public_runtime_configuration_mismatch");
      snapshot=structuredClone(c) as Snapshot;return {snapshot:structuredClone(snapshot),authorization:structuredClone(token.processing!)};
    },
    async credentials(component:"asr"|"translation"|"tts",purpose:"connect"|"dispatch",signal?:AbortSignal){
      if(!["connect","dispatch"].includes(purpose))throw Error("public_recovery_material_denied");
      const profile=snapshot?.components[component];if(!profile||snapshot!.executionPlan[component].execution!=="public")throw Error("public_runtime_component_disabled");
      const q=query(purpose),value=await credentials(q,component,gatewayCredential,signal);
      if(!object(value)||Object.keys(value).length!==3||value.component!==component||!matchesPublicAdmissionReceipt(value.receipt,q)||!object(value.credentials))throw Error("public_runtime_credentials_mismatch");
      const c=value.credentials,google=["google_service_account","google_adc"].includes(profile.authKind),tencent=profile.authKind==="tencent_secret";
      const required=google?["accessToken","accessTokenExpiresAt"]:tencent?["secretId","secretKey"]:["apiKey"],allowed=google?[...required,"quotaProjectId"]:required;
      if(required.some(k=>!(k in c))||Object.keys(c).some(k=>!allowed.includes(k))||Object.entries(c).some(([k,v])=>k==="accessTokenExpiresAt"?
        typeof v!=="number"||!Number.isFinite(v)||v<=Date.now()+profile.timeoutMs+30000:
        typeof v!=="string"||!v||v.length>65536||v.trim()!==v||/[\u0000-\u001f\u007f]/u.test(v)))throw Error("public_runtime_credentials_mismatch");
      return {...c} as {apiKey?:string;secretId?:string;secretKey?:string;accessToken?:string;accessTokenExpiresAt?:number;quotaProjectId?:string};
    },
  };
}
