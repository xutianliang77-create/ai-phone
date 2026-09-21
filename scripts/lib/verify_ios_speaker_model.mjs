import {readFileSync,statSync,realpathSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
const [manifestPath,rootPath]=process.argv.slice(2);
if(!manifestPath||!rootPath)throw Error('Usage: verify_ios_speaker_model.mjs manifest.json model.mlmodelc');
const manifest=JSON.parse(readFileSync(manifestPath,'utf8')),root=realpathSync(rootPath);
if(manifest.id!=='sortformer_v2_1_fastest'||manifest.revision!=='ae9a27ab45dc0aa3abede7d2d6bad2b7a69aa6d1'||
  manifest.files.length!==11||manifest.bytes!==240564360)throw Error('Unknown speaker candidate');
let bytes=0;
for(const entry of manifest.files){
  const path=resolve(root,entry.path);
  if(!realpathSync(path).startsWith(root+sep)||statSync(path).size!==entry.bytes||
    createHash('sha256').update(readFileSync(path)).digest('hex')!==entry.sha256)throw Error(`Speaker resource mismatch: ${entry.path}`);
  bytes+=entry.bytes;
}
if(bytes!==manifest.bytes)throw Error('Speaker resource size mismatch');
console.log(JSON.stringify({status:'RESOURCE_HASH_PASS',revision:manifest.revision,files:manifest.files.length,bytes}));
