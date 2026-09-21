import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
if(process.argv.includes('--help')){console.log('Usage: prepare_device_speaker_fixtures.mjs [fixture-root]');process.exit(0);}
const root=resolve(process.argv[2]??'.cache/speaker-validation-20260921'),out=join(root,'phone');
mkdirSync(out,{recursive:true});
const selected=[['natural','natural_fast_switch',16000],['synthetic','two_person_turns',16000],['synthetic','four_person',16000],['synthetic','overlap',16000],['natural','natural_fast_switch',24000]];
const cases=[];
for(const [group,sourceId,sampleRate] of selected){
  const id=sourceId+(sampleRate===24000?'_24k':'');
  const suite=JSON.parse(readFileSync(join(root,group,'suite.json'))),item=suite.cases.find(c=>c.id===sourceId);
  if(!item)throw Error(`Fixture ${id} absent`);
  const audio=join(root,group,item.audio),source=readFileSync(audio),output=join(out,`${id}.pcm`);
  const result=spawnSync('/usr/local/bin/ffmpeg',['-nostdin','-v','error','-y','-i',audio,'-ac','1','-ar',String(sampleRate),'-f','s16le',output],{timeout:30_000});
  if(result.status!==0)throw Error(`PCM conversion failed: ${id}: ${result.error??result.stderr}`);
  const pcm=readFileSync(output),sha256=createHash('sha256').update(pcm).digest('hex');
  cases.push({id,sampleRate,sha256,inputSamples:pcm.length/2,realtime:true,
    sourceSha256:createHash('sha256').update(source).digest('hex'),source:audio,reference:item.reference});
}
writeFileSync(join(out,'manifest.json'),JSON.stringify({schemaVersion:1,cases},null,2));
console.log(JSON.stringify({cases:cases.map(({id,inputSamples,sha256})=>({id,inputSamples,sha256})),path:out}));
