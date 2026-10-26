import {hash} from './common.mjs';
/** This hash describes our implementation contract, NOT Apple's model weights. */
export const COMPONENT_PROFILE={schemaVersion:1,execution:'on_device',profile:'apple-system-zh-en-v10-r1',
 providers:{asr:'apple_speech_transcriber',translation:'ios_system',tts:'system_tts',ocr:'vision'},
 languages:['zh','en'],systemResources:'os_managed',asrAutomaticLanguageQualified:false};
export const IMPLEMENTATION_HASH=hash(COMPONENT_PROFILE);
