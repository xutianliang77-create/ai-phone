import type {RealtimeExecutionPlan} from "@translation/contracts";
import {selectPublicModelConfigurationInternal} from "./public-model-config-store.js";
import {modelComponents,mergeConfiguration,PublicConfigError,publicConfiguration,
  type ModelComponent,type PublicModelConfiguration,type PublicModelProfile} from "./public-model-config.js";
import {resultSyncHash} from "../sessions/session-result-sync-contract.js";

/** Safe to persist in the original session aggregate, never contains credentials.
 * This is configuration identity, NOT supplier qualification or permission to call. */
export interface PublicModelRuntimeSnapshot {
  schemaVersion:1;deploymentId:string;configurationRevision:number;configurationHash:string;
  modelPolicyRevision:string;executionPlan:RealtimeExecutionPlan;
  components:Partial<Record<ModelComponent,PublicModelProfile>>;
}

function capture(config:PublicModelConfiguration,voiceOutput:boolean):PublicModelRuntimeSnapshot {
  if(typeof voiceOutput!=="boolean"||config.revision<1)throw new PublicConfigError("public_runtime_config_required",503);
  // Revalidate decrypted data with the editor's exact schema, including credentials.
  let validated:PublicModelConfiguration;
  const requestedComponents=structuredClone(config.components);
  // A session with reading disabled does not depend on an unused TTS rate.
  // Do not migrate the stored profile or change its revision/credentials.
  if(!voiceOutput)requestedComponents.tts.enabled=false;
  try{validated=mergeConfiguration(config,{expectedRevision:config.revision,components:requestedComponents,
    credentials:config.credentials,clearCredentials:[...modelComponents]});}
  catch{throw new PublicConfigError("public_runtime_config_invalid",503);}
  const status=publicConfiguration(validated).status;
  const components:PublicModelRuntimeSnapshot["components"]={};
  for(const component of modelComponents){
    if(component==="tts"&&!voiceOutput)continue;
    if(status[component].state!=="configured_not_verified")throw new PublicConfigError(`public_runtime_${component}_not_configured`,503);
    components[component]=validated.components[component];
    // These services select a named voice, not a model-name parameter. Keep
    // the editor value empty; give only its runtime/journal identity a label.
    if(component==="tts"&&["tencent_tts_ws","google_cloud_tts"].includes(components.tts!.protocol)&&!components.tts!.modelId){
      components.tts={...components.tts!,modelId:`service:${components.tts!.protocol}`};
    }
  }
  const identity={schemaVersion:1 as const,deploymentId:config.deploymentId,configurationRevision:config.revision,components};
  const configurationHash=resultSyncHash(identity),modelPolicyRevision=`models-v1:${configurationHash}`;
  const executionPlan:RealtimeExecutionPlan={asr:{execution:"public",scopeKey:"",reason:"online_selected"},
    translation:{execution:"public",scopeKey:"",reason:"online_selected"},tts:{execution:"disabled"}};
  for(const component of modelComponents){
    if(components[component])executionPlan[component]={execution:"public",reason:"online_selected",
      scopeKey:`${component}:${resultSyncHash({configurationHash,component})}`};
  }
  return {...identity,configurationHash,modelPolicyRevision,executionPlan};
}

export function capturePublicModelRuntimeConfiguration(voiceOutput:boolean):PublicModelRuntimeSnapshot {
  return selectPublicModelConfigurationInternal(config=>capture(config,voiceOutput));
}

/** Called immediately before dispatch by a trusted server adapter, never by a route.
 * Latest-only storage cannot recover an old credential revision after edits/restart.
 * Fail closed instead of silently swapping credentials for an existing session.
 * The returned secret must not be persisted, logged, placed in a token, or sent to the phone. */
export function resolvePublicModelRuntimeCredentials(snapshot:PublicModelRuntimeSnapshot,component:ModelComponent){
  return selectCurrentPublicModelConfiguration(snapshot,config=>{
    const profile=snapshot.components[component];
    if(!profile)throw new PublicConfigError("public_runtime_component_disabled",409);
    if(profile.authKind==="google_adc")throw new PublicConfigError("public_runtime_adc_not_resolved",503);
    return structuredClone(config.credentials[component]);
  });
}

/** Internal only; keeps both raw-key and token resolution on the same version check. */
export function selectCurrentPublicModelConfiguration<T>(snapshot:PublicModelRuntimeSnapshot,select:(config:PublicModelConfiguration)=>T){
  return selectPublicModelConfigurationInternal(config=>{
    const current=capture(config,snapshot.executionPlan.tts.execution!=="disabled");
    if(resultSyncHash(current)!==resultSyncHash(snapshot))throw new PublicConfigError("public_runtime_config_changed",409);
    return select(config);
  });
}
