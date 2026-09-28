import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {isPublicSessionTerminology,automaticSourceAllowed,automaticTranslationTarget,type RealtimeTokenClaims,type PublicSessionTerminology} from "@translation/contracts";
import {mergeTerminologyWithDomainPacks} from "../domain/domain-lexicon.js";
import type {RealtimeProviderSession} from "../providers/realtime-provider.js";

function canonical(v:any):string {
  if(Array.isArray(v))return `[${v.map(canonical).join(",")}]`;
  if(v&&typeof v==="object")return `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export function verifyPublicTerminology(value:unknown,claims:RealtimeTokenClaims):PublicSessionTerminology|undefined {
  if(claims.publicTerminologyHash===undefined){
    if(value!==undefined||claims.termbaseId||claims.domainLexiconPacks?.length)throw Error("public_terminology_binding_mismatch");
    return undefined;
  }
  if(!isPublicSessionTerminology(value)||!isDeepStrictEqual(value.domainLexiconPacks,claims.domainLexiconPacks??[])||
    value.termbaseId!==claims.termbaseId||createHash("sha256").update(canonical(value)).digest("hex")!==claims.publicTerminologyHash)
    throw Error("public_terminology_binding_mismatch");
  return structuredClone(value);
}
export function publicTerminologySessionFields(value:PublicSessionTerminology|undefined,_asrProtocol:string,
    policy:NonNullable<RealtimeTokenClaims["processing"]>["languagePolicy"]):Pick<RealtimeProviderSession,"terminology"|"asrHotwords"> {
  if(!value)return {};
  const seen=new Set<string>();
  const terminology=mergeTerminologyWithDomainPacks(value.terms,value.domainLexiconPacks).filter(t=>{
    const permitted=policy.source==="auto"?automaticSourceAllowed(policy,t.sourceLanguage)&&
      automaticTranslationTarget(t.sourceLanguage,policy.target,policy.autoReverse,policy.pair)===t.targetLanguage:
      t.sourceLanguage===policy.source&&t.targetLanguage===policy.target;
    const key=JSON.stringify([t.sourceLanguage,t.targetLanguage,t.sourceText.toLowerCase()]);
    if(!permitted||seen.has(key))return false;seen.add(key);return true;
  });
  // Selected MT terms are not evidence that the ASR model accepts hotwords.
  // Qwen3-ASR-Realtime's documented session.update has language, not corpus;
  // its model capability table explicitly marks accuracy enhancement unsupported.
  // None of the current public ASR adapters has verified inline-term delivery.
  // Preserve authorized MT terms without inventing an ASR request field.
  return {terminology};
}
