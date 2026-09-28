import {describe,expect,it} from 'vitest';
import {terminologyFor} from './lmstudio-realtime-helpers.js';
import type {TermbaseTermDto} from '@translation/contracts';
const term=(id:string,sourceText:string,sourceLanguage:'zh'|'en'='zh',targetLanguage:'zh'|'en'='en'):TermbaseTermDto=>({id,sourceText,translatedText:sourceText,sourceLanguage,targetLanguage,status:'active',createdAt:'2026-09-28T00:00:00Z',updatedAt:'2026-09-28T00:00:00Z'});
const session={sessionId:'selected',sourceLanguage:'zh' as const,targetLanguage:'en' as const,terminology:[term('n','Nova3 ASR'),term('l','Lumen2 TTS'),term('other','Nova3 ASR','en','zh'),term('ordinary','notes')]};
describe('authorized technical terminology matching without transcript replacement',()=>{
  it.each(['测试 Nova3 A S R。','测试 N o v a 3 A S R。','测试 nova3asr。'])(
    'selects the complete same-character identifier: %s',text=>{
      expect(terminologyFor(session,'zh','en',text).map(t=>t.id)).toEqual(['n']);
    });
  it.each(['跟 N A S R。','Nova A S R。','Nova4 A S R。','SuperNova3ASR。','Nova3ASRExtra。','Nova3. A S R。','Nova3\nA S R。','my n o t e s'])('does not guess missing characters, versions or independent words: %s',text=>{
    expect(terminologyFor(session,'zh','en',text)).toEqual([]);
  });
  it('does not leak another direction or unselected model vocabulary',()=>{
    expect(terminologyFor(session,'fr','zh','Nova3 A S R')).toEqual([]);
    expect(terminologyFor({...session,terminology:[]},'zh','en','Nova3 A S R')).toEqual([]);
    expect(terminologyFor(session,'en','zh','Nova3 A S R').map(t=>t.id)).toEqual(['other']);
  });
});
