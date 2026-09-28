import {describe,expect,it} from 'vitest';
import {domainLexiconVersion,type PublicSessionTerminology} from '@translation/contracts';
import {publicTerminologySessionFields} from './public-session-terminology.js';

const terms:PublicSessionTerminology={version:1,domainLexiconVersion,domainLexiconPacks:['product'],terms:[]};
const automatic={source:'auto' as const,target:'zh' as const,autoReverse:true,pair:['zh','en'] as ['zh','en'],revision:1};
describe('authorized terminology is separate from ASR adapter capabilities',()=>{
  it('only the verified task protocol receives source terms from the signed account/direction selection',()=>{
    const fields=publicTerminologySessionFields(terms,'qwen_audio_streaming',automatic);
    expect(fields.asrHotwords).toContain('Qwen3 ASR');expect(fields.asrHotwords!.length).toBeLessThanOrEqual(120);
    expect(fields.asrHotwords!.every(word=>fields.terminology!.some(t=>t.sourceText===word))).toBe(true);
    expect(publicTerminologySessionFields(terms,'qwen_audio_streaming',{source:'fr',target:'zh',autoReverse:false,revision:1}).asrHotwords).toBeUndefined();
  });
  it.each(['qwen_asr_realtime','openai_realtime_asr','tencent_asr_ws','google_speech_v2'])(
    'keeps MT terms without claiming unsupported inline ASR hints: %s',protocol=>{
      const fields=publicTerminologySessionFields(terms,protocol,automatic);
      expect(fields.terminology?.some(t=>t.sourceText==='Qwen3 ASR')).toBe(true);
      expect(fields.terminology?.some(t=>t.sourceLanguage==='zh'&&t.targetLanguage==='en')).toBe(true);
      expect(fields.terminology?.some(t=>t.sourceLanguage==='en'&&t.targetLanguage==='zh')).toBe(true);
      expect(fields).not.toHaveProperty('asrHotwords');expect(fields).not.toHaveProperty('asrCorrections');
    });
  it('does not leak product terms into an unrelated fixed direction',()=>{
    expect(publicTerminologySessionFields(terms,'qwen_asr_realtime',{source:'fr',target:'zh',autoReverse:false,revision:1}).terminology).toEqual([]);
    expect(publicTerminologySessionFields({...terms,domainLexiconPacks:[]},'qwen_asr_realtime',automatic).terminology).toEqual([]);
  });
  it('retains private term priority within the sealed snapshot, not another owner cache',()=>{
    const custom={id:'own',sourceLanguage:'zh' as const,targetLanguage:'en' as const,sourceText:'会议纪要',translatedText:'CUSTOM MINUTES',status:'active' as const,createdAt:'2026-09-28T00:00:00Z',updatedAt:'2026-09-28T00:00:00Z'};
    const a=publicTerminologySessionFields({...terms,terms:[custom]},'qwen_asr_realtime',automatic);
    const b=publicTerminologySessionFields(terms,'qwen_asr_realtime',automatic);
    expect(a.terminology?.filter(t=>t.sourceLanguage==='zh'&&t.sourceText==='会议纪要').map(t=>t.translatedText)).toEqual(['CUSTOM MINUTES']);
    expect(b.terminology?.some(t=>t.translatedText==='CUSTOM MINUTES')).toBe(false);
  });
});
