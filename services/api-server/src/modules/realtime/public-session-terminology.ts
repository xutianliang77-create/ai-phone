import {automaticSourceAllowed,automaticTranslationTarget,domainLexiconVersion,isPublicSessionTerminology,
  type CreateRealtimeSessionRequest,type PublicSessionTerminology} from "@translation/contracts";
import {listActiveTerms} from "../terms/terms-runtime.repository.js";
import {ResultSyncError} from "../sessions/session-result-sync-contract.js";

export async function capturePublicTerminology(ownerId:string,input:CreateRealtimeSessionRequest):Promise<PublicSessionTerminology|undefined> {
  const policy=input.processing!.languagePolicy;
  const rows=input.termbaseId?await listActiveTerms({userId:ownerId,termbaseId:input.termbaseId}):[];
  const terms=rows.filter(t=>policy.source==="auto"
    ?automaticSourceAllowed(policy,t.sourceLanguage)&&automaticTranslationTarget(t.sourceLanguage,policy.target,policy.autoReverse,policy.pair)===t.targetLanguage
    :t.sourceLanguage===policy.source&&t.targetLanguage===policy.target).map(t=>({id:t.id,
      sourceText:t.sourceText,translatedText:t.translatedText,sourceLanguage:t.sourceLanguage,targetLanguage:t.targetLanguage,
      status:t.status,createdAt:t.createdAt,updatedAt:t.updatedAt}));
  const snapshot:PublicSessionTerminology={version:1,domainLexiconVersion,
    ...(input.termbaseId?{termbaseId:input.termbaseId}:{}),domainLexiconPacks:[...(input.domainLexiconPacks??["product"])],terms};
  if(!isPublicSessionTerminology(snapshot))throw new ResultSyncError("public_terminology_invalid",503);
  return snapshot;
}
