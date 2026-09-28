import {looksLikeProtectedTerm} from '@translation/speech-quality';

/** Reuse v1's identifier protection only for the text-LID observation. Never
 * alter the ASR subtitle, glossary, token offsets or text submitted to MT. */
export function textForLanguageObservation(text:string) {
  return text.replace(/[A-Za-z][A-Za-z0-9_/-]*/gu,
    token=>looksLikeProtectedTerm(token)?' '.repeat(token.length):token);
}

export function canonicalTextLanguage(language:string) {
  return ['zh','zh-Hans','zh-Hant'].includes(language)?'zh':language;
}

/** Simplified/traditional are script variants of the product's same Chinese
 * source, not competing languages. No mass is removed or renormalized from
 * unsupported languages into the selected output pair. */
export function aggregateTextLanguages(hypotheses:Record<string,number>) {
  const result=new Map<string,number>();
  for(const [language,probability] of Object.entries(hypotheses)){
    const key=canonicalTextLanguage(language);
    result.set(key,(result.get(key)??0)+probability);
  }
  return [...result].sort((a,b)=>b[1]-a[1]);
}
