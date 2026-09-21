import {it,expect} from 'vitest';
import {automaticTranslationTarget,automaticSourceAllowed,validAutomaticSources} from './automatic-language-routing.js';
import {resolveTranslationDirection,isLanguageSelection} from './processing-policy.js';
const selection={source:'auto' as const,target:'en' as const,autoReverse:true,pair:['zh','en'] as const,
  sourceLanguages:['zh','en','ja','fr'] as const,revision:2};
it.each([['zh','en'],['en','zh'],['ja','zh'],['fr','zh'],['yue','en']] as const)('preserves the frozen v1 route for %s', (source,target)=>{
  expect(automaticTranslationTarget(source,'en',true,['zh','en'])).toBe(target);
});
it('third language uses the selected primary language, never an implicit Chinese default',()=>{
  expect(automaticTranslationTarget('ja','zh',true,['en','zh'])).toBe('zh');
  expect(automaticTranslationTarget('ja','en',true,['fr','en'])).toBe('fr');
  expect(automaticTranslationTarget('ja','de',false)).toBe('de');
});
it('an explicitly authorized third language resolves instead of becoming outside_pair',()=>{
  expect(resolveTranslationDirection(selection,{kind:'detected',language:'ja',source:'acoustic',qualified:true}))
    .toEqual({status:'ready',source:'ja',target:'zh',revision:2});
  expect(resolveTranslationDirection({...selection,sourceLanguages:undefined},{kind:'detected',language:'ja',source:'acoustic',qualified:true}))
    .toMatchObject({status:'unresolved',reason:'outside_pair'});
});
it('unknown, mixed, unsupported and ungranted source evidence stay fail closed',()=>{
  expect(automaticSourceAllowed(selection,'ru')).toBe(false);
  expect(validAutomaticSources(['ja','ja'])).toBe(false);
  expect(isLanguageSelection({...selection,source:'zh'})).toBe(false);
  expect(resolveTranslationDirection(selection,{kind:'unknown'})).toMatchObject({status:'unresolved'});
  expect(resolveTranslationDirection(selection,{kind:'detected',language:'ja',source:'acoustic',qualified:false})).toMatchObject({status:'unresolved'});
});
