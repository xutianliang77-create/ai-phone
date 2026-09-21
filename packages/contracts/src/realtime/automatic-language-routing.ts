import {isTranslationLanguage,type TranslationLanguageCode} from '../shared/languages.js';

/** The selected pair controls direction, not how many languages an ASR can
 * recognize. Preserve frozen 1.0's Chinese fallback for the Chinese/English
 * pair in either order. Other configured pairs use their first (primary)
 * language, rather than forcing every language pair to Chinese. */
export function automaticTranslationTarget(source:TranslationLanguageCode,target:TranslationLanguageCode,
    autoReverse:boolean,pair?:readonly [TranslationLanguageCode,TranslationLanguageCode]):TranslationLanguageCode {
  if(!autoReverse||!pair)return target;
  if(source===pair[0])return pair[1];
  if(source===pair[1])return pair[0];
  const chinese=(value:string)=>['zh','zh-Hant','yue'].includes(value);
  if(chinese(pair[0])!==chinese(pair[1])&&chinese(source))return chinese(pair[0])?pair[1]:pair[0];
  const chineseSide=pair.find(chinese);
  return pair.includes('en')&&chineseSide?chineseSide:pair[0];
}

/** New scopes are explicit and signed. Missing sourceLanguages retains the
 * old pair-bounded authorization; never widen an already-issued token. */
export function automaticSourceAllowed(policy:{sourceLanguages?:readonly TranslationLanguageCode[];pair?:readonly TranslationLanguageCode[]},language:string):language is TranslationLanguageCode {
  return isTranslationLanguage(language)&&(policy.sourceLanguages??policy.pair)?.includes(language)===true;
}
export function validAutomaticSources(value:unknown):value is TranslationLanguageCode[] {
  return Array.isArray(value)&&value.length>0&&value.length<=64&&new Set(value).size===value.length&&value.every(isTranslationLanguage);
}
