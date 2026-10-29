import {hash} from './common.mjs';
/** This hash describes our implementation contract, NOT Apple's model weights. */
export const COMPONENT_PROFILE={schemaVersion:1,execution:'on_device',profile:'apple-system-zh-en-v10-r1',
 providers:{asr:'apple_speech_transcriber',translation:'ios_system',tts:'system_tts',ocr:'vision'},
 languages:['zh','en'],systemResources:'os_managed',asrAutomaticLanguageQualified:false};
export const IMPLEMENTATION_HASH=hash(COMPONENT_PROFILE);

// V2 is intentionally limited to the existing qualified scope. Additional
// languages require an explicit source change and independent qualification;
// OS inventory alone is never an authorization allowlist.
export const COMPONENT_PROFILE_V2={schemaVersion:2,execution:'on_device',profile:'apple-system-qualified-v10-r2',
 providers:{asr:'apple_speech_transcriber',translation:'ios_system',tts:'system_tts',ocr:'vision'},
 languages:['zh','en'],systemResources:'os_managed',asrAutomaticLanguageQualified:false};
export const IMPLEMENTATION_HASH_V2=hash(COMPONENT_PROFILE_V2);
Object.freeze(COMPONENT_PROFILE_V2.languages);
Object.freeze(COMPONENT_PROFILE_V2.providers);
Object.freeze(COMPONENT_PROFILE_V2);

export function licenseProfile(profile,implementationHash,enabled){
 if(profile===COMPONENT_PROFILE.profile&&implementationHash===IMPLEMENTATION_HASH)
  return {profile:COMPONENT_PROFILE,hash:IMPLEMENTATION_HASH,version:1};
 if(enabled&&profile===COMPONENT_PROFILE_V2.profile&&implementationHash===IMPLEMENTATION_HASH_V2)
  return {profile:COMPONENT_PROFILE_V2,hash:IMPLEMENTATION_HASH_V2,version:2};
 return null;
}
