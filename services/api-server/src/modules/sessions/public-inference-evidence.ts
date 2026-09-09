import {publicModelComponents,type ModelComponent} from "@translation/contracts";
import type {SessionRecord} from "./session-record.js";
import type {PublicInferenceAdmission} from "./public-runtime-admission.js";
import {ResultSyncError,resultSyncHash,syncKey} from "./session-result-sync-contract.js";

interface EvidenceIdentity {
  id:string;sessionId:string;ownerId:string;deploymentId:string;processingHash:string;
  region:string;providerPolicyRevision:string;sourceReceiptId:string;
  issuedAt:string;expiresAt:string;revokedAt?:string;
}
export type PublicInferenceEvidence = EvidenceIdentity & (
  | {kind:"inference_consent";version:"public-inference-v1";components:ModelComponent[]}
  | {kind:"provider_budget";state:"reserved";currency:string;reservedMicros:number;maxActiveSeconds:number;sampleRate:16000|24000}
  | {kind:"model_qualification";state:"qualified";component:ModelComponent;scopeKey:string;providerId:string;modelId:string}
);
export interface InferenceEvidenceRefs {
  consentReceiptId:string;budgetReservationId:string;
  qualificationReceiptIds:Partial<Record<ModelComponent,string>>;
}

export function inferenceProcessingHash(session:SessionRecord) {
  const p=session.processingAuthorization;
  if(!p)throw new ResultSyncError("public_inference_admission_required",503);
  return resultSyncHash({modelPolicyRevision:p.modelPolicyRevision,languagePolicy:p.languagePolicy,executionPlan:p.executionPlan});
}
export function validateInferenceEvidence(session:SessionRecord,e:PublicInferenceEvidence,now:Date){
  const allowed=["id","sessionId","ownerId","deploymentId","processingHash","region","providerPolicyRevision",
    "sourceReceiptId","issuedAt","expiresAt","revokedAt",...(e?.kind==="inference_consent"?["kind","version","components"]:
      e?.kind==="provider_budget"?["kind","state","currency","reservedMicros","maxActiveSeconds","sampleRate"]:
      ["kind","state","component","scopeKey","providerId","modelId"])];
  if(!e||Object.keys(e).some(k=>!allowed.includes(k))||
    ![e.id,e.region,e.providerPolicyRevision,e.sourceReceiptId].every(syncKey)||
    e.sessionId!==session.id||e.ownerId!==session.userId||e.deploymentId!==session.processingDeploymentId||
    e.processingHash!==inferenceProcessingHash(session)||e.revokedAt!==undefined||
    typeof e.issuedAt!=="string"||typeof e.expiresAt!=="string"||!Number.isFinite(now.getTime())||
    !Number.isFinite(Date.parse(e.issuedAt))||Date.parse(e.issuedAt)>now.getTime()||
    !Number.isFinite(Date.parse(e.expiresAt))||Date.parse(e.expiresAt)<=now.getTime())throw new ResultSyncError("public_evidence_invalid",403);
  if(e.kind==="inference_consent"){
    if(e.version!=="public-inference-v1"||!Array.isArray(e.components)||!e.components.length||
      new Set(e.components).size!==e.components.length||e.components.some(c=>!["asr","translation","tts"].includes(c)))throw new ResultSyncError("public_evidence_invalid",403);
  }else if(e.kind==="provider_budget"){
    if(e.state!=="reserved"||typeof e.currency!=="string"||!/^[A-Z]{3}$/.test(e.currency)||
      !Number.isSafeInteger(e.reservedMicros)||e.reservedMicros<0||!Number.isSafeInteger(e.maxActiveSeconds)||
      e.maxActiveSeconds<1||e.maxActiveSeconds>86400||![16000,24000].includes(e.sampleRate))throw new ResultSyncError("public_evidence_invalid",403);
  }else if(e.kind==="model_qualification"){
    const component=session.processingAuthorization?.executionPlan[e.component];
    if(e.state!=="qualified"||![e.scopeKey,e.providerId,e.modelId].every(syncKey)||
      component?.execution!=="public"||component.scopeKey!==e.scopeKey)throw new ResultSyncError("public_evidence_invalid",403);
  }else throw new ResultSyncError("public_evidence_invalid",403);
  // Configuration-bound sessions cannot qualify a different vendor/model under
  // the same human-readable policy. Legacy synthetic fixtures remain unchanged.
  const config=session.publicModelConfiguration;
  if(config){
    if(config.deploymentId!==session.processingDeploymentId||
      config.modelPolicyRevision!==session.processingAuthorization?.modelPolicyRevision||
      resultSyncHash(config.executionPlan)!==resultSyncHash(session.processingAuthorization?.executionPlan)||
      e.providerPolicyRevision!==config.modelPolicyRevision)throw new ResultSyncError("public_evidence_config_mismatch",403);
    if(e.kind==="model_qualification"){
      const profile=config.components[e.component];
      // Protocols without an explicit model ID qualify the exact configured scope.
      if(!profile||e.providerId!==profile.vendor||e.modelId!==(profile.modelId||e.scopeKey))throw new ResultSyncError("public_evidence_config_mismatch",403);
    }
    if(e.kind==="provider_budget"&&e.sampleRate!==config.components.asr?.sampleRate)throw new ResultSyncError("public_evidence_config_mismatch",403);
  }
}

/** Resolve stored receipts in the same aggregate; caller-supplied reference IDs alone cannot grant access. */
export function resolveInferenceEvidence(session:SessionRecord,refs:InferenceEvidenceRefs,now:Date){
  const records=session.publicInferenceEvidence??[];
  const selected:PublicInferenceEvidence[]=[];
  const get=(id:string,kind:PublicInferenceEvidence["kind"])=>{
    const matches=records.filter(e=>e.id===id);
    if(!syncKey(id)||matches.length!==1||matches[0].kind!==kind)throw new ResultSyncError("public_evidence_not_found",403);
    const e=matches[0];validateInferenceEvidence(session,e,now);selected.push(e);return e;
  };
  const consent=get(refs.consentReceiptId,"inference_consent") as Extract<PublicInferenceEvidence,{kind:"inference_consent"}>;
  const budget=get(refs.budgetReservationId,"provider_budget") as Extract<PublicInferenceEvidence,{kind:"provider_budget"}>;
  const components=publicModelComponents(session.processingAuthorization!.executionPlan);
  if(components.some(c=>!consent.components.includes(c))||Object.keys(refs.qualificationReceiptIds??{}).some(c=>!components.includes(c as ModelComponent))){
    throw new ResultSyncError("public_evidence_scope_mismatch",403);
  }
  const qualifications=components.map(c=>{
    const q=get(refs.qualificationReceiptIds?.[c]??"","model_qualification") as Extract<PublicInferenceEvidence,{kind:"model_qualification"}>;
    if(q.component!==c)throw new ResultSyncError("public_evidence_scope_mismatch",403);return q;
  });
  if(selected.some(e=>e.region!==consent.region||e.providerPolicyRevision!==consent.providerPolicyRevision))throw new ResultSyncError("public_evidence_scope_mismatch",403);
  return {consent,budget,qualifications,evidenceHash:resultSyncHash(selected)};
}
export function assertAdmissionEvidence(session:SessionRecord,a:PublicInferenceAdmission,now:Date){
  const e=resolveInferenceEvidence(session,a,now);
  if(a.evidenceHash!==e.evidenceHash||a.expiresAt!==e.consent.expiresAt||a.budgetExpiresAt!==e.budget.expiresAt||
    a.qualificationExpiresAt!==new Date(Math.min(...e.qualifications.map(q=>Date.parse(q.expiresAt)))).toISOString()||
    a.maxActiveSeconds!==e.budget.maxActiveSeconds||a.sampleRate!==e.budget.sampleRate)throw new ResultSyncError("public_admission_evidence_conflict",403);
}
