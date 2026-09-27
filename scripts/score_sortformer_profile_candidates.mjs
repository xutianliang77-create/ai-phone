import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compareSortformerProfiles,compareSortformerCachePolicies} from './lib/sortformer_profile_comparison.mjs';
if(process.argv[2]==='--cache'){
  const [manifestPath,a,b,c,output]=process.argv.slice(3);
  if(!output||existsSync(output))throw Error('Usage: --cache manifest arm24 arm31 arm40 NEW-output');
  const data=readFileSync(manifestPath),result=compareSortformerCachePolicies(JSON.parse(data),[a,b,c].map(p=>JSON.parse(readFileSync(p))),createHash('sha256').update(data).digest('hex'));
  writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({selected:result.selectedCacheUpdateFrames,validationPassed:result.validationPassed,
    arms:result.arms.map(a=>({cache:a.cacheUpdateFrames,calibration:a.calibrationMicroDer,validation:a.validationMicroDer,
      cases:a.cases.map(c=>({id:c.id,der:c.metrics.diarizationErrorRate,speakers:c.predictedSpeakers}))}))},null,2));
  process.exit(0);
}
const [manifestPath,fastPath,balancedPath,outputPath]=process.argv.slice(2);
if(!manifestPath||!fastPath||!balancedPath||!outputPath||existsSync(outputPath))throw Error('Usage: manifest fast-decoded balanced-decoded NEW-output');
const raw=readFileSync(manifestPath),manifest=JSON.parse(raw),read=p=>JSON.parse(readFileSync(p));
const result=compareSortformerProfiles(manifest,[read(fastPath),read(balancedPath)],createHash('sha256').update(raw).digest('hex'));
writeFileSync(outputPath,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:result.status,baseline:result.baseline.cases.map(c=>({id:c.id,der:c.metrics.diarizationErrorRate,speakers:c.predictedSpeakers})),
  selected:result.selected.map(v=>({profile:v.profile,name:v.name,activity:v.activity,calibrationDer:v.calibrationMicroDer,
    validationDer:v.validationMicroDer,validationPassed:v.validationPassed,cases:v.cases.map(c=>({id:c.id,der:c.metrics.diarizationErrorRate,speakers:c.predictedSpeakers}))})),
  modelOnly:result.modelOnly.map(v=>({profile:v.profile,calibrationDer:v.calibrationMicroDer,validationDer:v.validationMicroDer,validationPassed:v.validationPassed}))},null,2));
