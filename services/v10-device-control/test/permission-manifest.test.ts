import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';

it.each(['Info-Formal.plist','Info.plist'])('ships nonempty speech and microphone purpose strings in %s',name=>{
 const plist=readFileSync(new URL('../../../apps/mobile/ios/Runner/'+name,import.meta.url),'utf8');
 // requestAuthorization on the native bridge requires its Info.plist purpose
 // string even before any recognition model is prepared or run.
 for(const key of ['NSSpeechRecognitionUsageDescription','NSMicrophoneUsageDescription']){
  const match=plist.match(new RegExp('<key>'+key+'</key>\\s*<string>([^<]+)</string>'));
  expect(match?.[1]?.trim(),name+':'+key).toBeTruthy();
 }
});
