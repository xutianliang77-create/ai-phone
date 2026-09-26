import type {TermbaseTermDto} from "../api/realtime-review.js";
import {domainLexiconVersion,domainLexiconPackCodes as domainLexiconPacks,type DomainLexiconPack} from "../shared/domain-lexicon.js";
import {isTranslationLanguage} from "../shared/languages.js";

/** Account-owned terms captured once at preparation. Catalog terms are resolved
 * by the matching code version, never by a private Gateway default selection. */
export interface PublicSessionTerminology {
  version: 1;
  domainLexiconVersion: string;
  termbaseId?: string;
  domainLexiconPacks: DomainLexiconPack[];
  terms: TermbaseTermDto[];
}

/** Vendor-managed public dictionaries, explicitly mapped to each direction.
 * Repository IDs are configuration, not credentials or personal term content. */
export type TranslationTermRepositories = Record<string,string[]>;
export function validTranslationTermRepositories(value:unknown):value is TranslationTermRepositories {
  return !!value&&typeof value==="object"&&!Array.isArray(value)&&Object.keys(value).length<=64&&
    Object.entries(value).every(([pair,ids])=>{
      const [source,target,...extra]=pair.split(":");
      return !extra.length&&isTranslationLanguage(source)&&isTranslationLanguage(target)&&source!==target&&
        Array.isArray(ids)&&ids.length>0&&ids.length<=10&&new Set(ids).size===ids.length&&
        ids.every(id=>typeof id==="string"&&/^[A-Za-z0-9_-]{1,80}$/.test(id));
    });
}

export function isPublicSessionTerminology(value:unknown):value is PublicSessionTerminology {
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const v=value as PublicSessionTerminology;
  const text=(s:unknown,max:number):s is string=>typeof s==="string"&&s.length>0&&s.length<=max&&s.trim()===s&&!/[\u0000-\u001f\u007f]/u.test(s);
  return Object.keys(v).every(k=>["version","domainLexiconVersion","termbaseId","domainLexiconPacks","terms"].includes(k))&&
    v.version===1&&v.domainLexiconVersion===domainLexiconVersion&&
    (v.termbaseId===undefined||text(v.termbaseId,240))&&Array.isArray(v.domainLexiconPacks)&&
    v.domainLexiconPacks.length<=domainLexiconPacks.length&&new Set(v.domainLexiconPacks).size===v.domainLexiconPacks.length&&
    v.domainLexiconPacks.every(p=>domainLexiconPacks.includes(p))&&Array.isArray(v.terms)&&v.terms.length<=500&&
    v.terms.every(t=>t&&typeof t==="object"&&!Array.isArray(t)&&
      Object.keys(t).every(k=>["id","sourceText","translatedText","sourceLanguage","targetLanguage","status","createdAt","updatedAt"].includes(k))&&
      text(t.id,240)&&text(t.sourceText,80)&&text(t.translatedText,120)&&t.status==="active"&&
      isTranslationLanguage(t.sourceLanguage)&&isTranslationLanguage(t.targetLanguage)&&t.sourceLanguage!==t.targetLanguage&&
      typeof t.createdAt==="string"&&t.createdAt.length<=64&&Number.isFinite(Date.parse(t.createdAt))&&
      typeof t.updatedAt==="string"&&t.updatedAt.length<=64&&Number.isFinite(Date.parse(t.updatedAt)));
}
