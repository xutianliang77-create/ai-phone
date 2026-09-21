import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {validateCreateRealtimeSessionRequest} from './create-session-request.js';
import {publicRuntimeTokenBinding} from '@translation/contracts';
it('accepts the exact Flutter-generated multilingual request and preserves its signed scope',()=>{
  const body=JSON.parse(readFileSync(new URL('../../../../../apps/mobile/test/fixtures/public_multilingual_request.json',import.meta.url),'utf8'));
  const parsed=validateCreateRealtimeSessionRequest(body);expect(parsed.ok).toBe(true);
  if(!parsed.ok)throw Error('fixture rejected');
  expect(parsed.value.processing?.languagePolicy).toEqual(body.processing.languagePolicy);
  const p=parsed.value.processing!;
  const claims:any={sessionId:'session',userId:'owner',mode:body.mode,sourceLanguage:'auto',targetLanguage:'en',autoReverseTargetLanguage:true,
    voiceOutput:false,planCode:'test',issuedAt:1,expiresAt:1000,
    processing:{contractVersion:1,processingMode:'online',modelPolicyRevision:p.modelPolicyRevision,executionPlan:p.executionPlan,
      languagePolicy:p.languagePolicy,syncPermission:{allowed:false},publicGrantRef:'grant'},
    publicRuntime:{deploymentId:'public',leaseId:'lease',captureId:'capture',languagePolicyKey:'language:1',sampleRate:16000,configurationRevision:1,configurationHash:'a'.repeat(64)}};
  expect(publicRuntimeTokenBinding(claims,'public')).not.toBeNull();
  body.processing.languagePolicy.sourceLanguages.push('ko');
  expect(claims.processing.languagePolicy.sourceLanguages).toEqual(['zh','en','ja','fr']);
});
