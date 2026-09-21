import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=resolve(process.argv[2]??'.cache/speaker-validation-20260921'),out=join(root,'phone');
mkdirSync(out,{recursive:true});
const selected=[['natural','natural_fast_switch'],['synthetic','two_person_turns'],['synthetic','four_person'],['synthetic','overlap']];
const cases=[];
for(const [group,id] of selected){
  const suite=JSON.parse(readFileSync(join(root,group,'suite.json'))),item=suite.cases.find(c=>c.id===id);
  if(!item)throw Error(`Fixture ${id} absent`);
  const audio=join(root,group,item.audio),source=readFileSync(audio),output=join(out,`${id}.pcm`);
  const result=spawnSync('/usr/local/bin/ffmpeg',['-nostdin','-v','error','-y','-i',audio,'-ac','1','-ar','16000','-f','s16le',output],{timeout:30_000});
  if(result.status!==0)throw Error(`PCM conversion failed: ${id}: ${result.error??result.stderr}`);
  const pcm=readFileSync(output),sha256=createHash('sha256').update(pcm).digest('hex');
  cases.push({id,sampleRate:16000,sha256,inputSamples:pcm.length/2,realtime:true,
    sourceSha256:createHash('sha256').update(source).digest('hex'),source:audio,reference:item.reference});
}
writeFileSync(join(out,'manifest.json'),JSON.stringify({schemaVersion:1,cases},null,2));
console.log(JSON.stringify({cases:cases.map(({id,inputSamples,sha256})=>({id,inputSamples,sha256})),path:out}));
