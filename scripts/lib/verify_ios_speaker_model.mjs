import {readFileSync,statSync,realpathSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';

export function knownIOSSpeakerCandidate(manifest){
  const name={sortformer_v2_1_fastest:'ios-speaker-model-candidate.json',sortformer_v2_1_balanced:'ios-speaker-balanced-candidate.json'}[manifest?.id];
  if(!name)throw Error('Unknown speaker candidate');
  const trusted=JSON.parse(readFileSync(new URL(`../../release/public/1.1.0/${name}`,import.meta.url),'utf8'));
  if(!isDeepStrictEqual(manifest,trusted))throw Error('Speaker manifest does not match frozen source');
  return trusted;
}

export function verifyIOSSpeakerModel(manifest,rootPath){
  knownIOSSpeakerCandidate(manifest);
  const root=realpathSync(rootPath);let bytes=0;
  for(const entry of manifest.files){
    const path=resolve(root,entry.path);
    if(!realpathSync(path).startsWith(root+sep)||statSync(path).size!==entry.bytes||
      createHash('sha256').update(readFileSync(path)).digest('hex')!==entry.sha256)throw Error(`Speaker resource mismatch: ${entry.path}`);
    bytes+=entry.bytes;
  }
  if(bytes!==manifest.bytes)throw Error('Speaker resource size mismatch');
  return {status:'RESOURCE_HASH_PASS',profile:manifest.id,revision:manifest.revision,files:manifest.files.length,bytes};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [manifestPath,rootPath]=process.argv.slice(2);
  if(!manifestPath||!rootPath)throw Error('Usage: verify_ios_speaker_model.mjs manifest.json model.mlmodelc');
  console.log(JSON.stringify(verifyIOSSpeakerModel(JSON.parse(readFileSync(manifestPath,'utf8')),rootPath)));
}
