import {capturePublicModelRuntimeConfiguration} from "../models/public-model-runtime-config.js";
import {assertPublicSession,publicDeploymentId,mutatePublicSession} from "./session-result-sync.service.js";
import {ResultSyncError,resultSyncHash} from "./session-result-sync-contract.js";

/** Internal preparation before evidence/grant/lease issuance, on the original
 * session record. No public endpoint or provider call is enabled by this binding. */
export function bindPublicModelConfiguration(sessionId:string,ownerId:string,expectedRevision:number){
  const deployment=publicDeploymentId();
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)throw new ResultSyncError("public_config_revision_invalid",400);
  return mutatePublicSession(sessionId,"public-model-configuration",{expectedRevision},current=>{
    assertPublicSession(current,ownerId,deployment);
    const authorization=current.processingAuthorization!;
    const snapshot=capturePublicModelRuntimeConfiguration(authorization.executionPlan.tts.execution!=="disabled");
    if(snapshot.deploymentId!==deployment||snapshot.configurationRevision!==expectedRevision)throw new ResultSyncError("public_config_revision_conflict");
    if(authorization.modelPolicyRevision!==snapshot.modelPolicyRevision||
      resultSyncHash(authorization.executionPlan)!==resultSyncHash(snapshot.executionPlan))throw new ResultSyncError("public_config_processing_mismatch");
    if(current.publicModelConfiguration){
      if(resultSyncHash(current.publicModelConfiguration)!==resultSyncHash(snapshot))throw new ResultSyncError("public_config_binding_conflict");
      return {next:null,result:structuredClone(current.publicModelConfiguration)};
    }
    if(current.status!=="created"||current.publicInferenceEvidence?.length||current.publicInferenceAdmission||
      authorization.publicGrantRef||current.publicRuntimePolicy||current.publicRuntime||current.publicModelAttempts?.length||current.publicFinalization){
      throw new ResultSyncError("public_config_binding_sealed");
    }
    const next=structuredClone(current);next.publicModelConfiguration=snapshot;
    return {next,result:structuredClone(snapshot)};
  });
}
