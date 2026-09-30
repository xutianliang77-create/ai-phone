#!/usr/bin/env node
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeAudioSnapshot, nativeAudioSuites } from './lib/ios_native_audio_gate.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
if(args.length && (args.length!==2||args[0]!=='--output'))throw Error('usage: check_ios_native_audio.mjs [--output receipt.json]');
const output=args.length?path.resolve(args[1]):null;
if(output&&existsSync(output))throw Error('native audio receipt already exists; choose a new path');
let temporary;
const report={schemaVersion:1,status:'FAIL',platform:process.platform,usesMicrophone:false,modelCalls:0,
  dataMode:'synthetic_and_redacted_metadata',startedAt:new Date().toISOString(),suites:[]};
function run(command,arguments_) {
  const start=Date.now(),r=spawnSync(command,arguments_,{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
  return {exitCode:r.status,signal:r.signal,error:r.error?.code??null,durationMs:Date.now()-start,stdout:r.stdout??'',stderr:r.stderr??''};
}
function succeeded(r){return r.exitCode===0&&!r.signal&&!r.error;}
try {
  if(process.platform!=='darwin')throw Error('macOS with Xcode is required; unsupported hosts do not count as PASS');
  report.before=nativeAudioSnapshot(root);
  const sdk=run('xcrun',['--sdk','macosx','--show-sdk-path']);
  if(!succeeded(sdk))throw Error('macOS SDK unavailable');
  report.sdk=sdk.stdout.trim();
  report.toolchain=run('xcrun',['swiftc','--version']);
  if(!succeeded(report.toolchain))throw Error('Swift compiler unavailable');
  temporary=mkdtempSync(path.join(tmpdir(),'wujie-ios-native-audio-'));
  for(const suite of nativeAudioSuites) {
    const binary=path.join(temporary,suite.id);
    const item={id:suite.id,compile:run('xcrun',['--sdk','macosx','swiftc','-O','-swift-version','5',
      '-sdk',sdk.stdout.trim(),'-module-cache-path',path.join(temporary,'modules'),...suite.sources,'-o',binary])};
    report.suites.push(item);
    if(!succeeded(item.compile))throw Error('native compile failed: '+suite.id);
    item.run=run(binary,suite.args.map(p=>path.join(root,p)));
    if(!succeeded(item.run))throw Error('native regression failed: '+suite.id);
    process.stdout.write(`${suite.id}: ${item.run.stdout.trim()}\n`);
  }
  report.after=nativeAudioSnapshot(root);
  if(report.before.inputHash!==report.after.inputHash||report.before.sourceCommit!==report.after.sourceCommit||report.before.sourceTree!==report.after.sourceTree||report.before.sourceState!==report.after.sourceState)throw Error('source changed during native regression');
  report.status='HOST_PASS';
} catch(error) {
  report.error=error.message;process.exitCode=1;
  process.stderr.write(error.message+'\n');
} finally {
  // Only this invocation's own mkdtemp directory; no user cache/model cleanup.
  if(temporary)rmSync(temporary,{recursive:true,force:true});
  report.finishedAt=new Date().toISOString();
  if(output){mkdirSync(path.dirname(output),{recursive:true,mode:0o700});writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});}
}
console.log(JSON.stringify({status:report.status,suites:report.suites.length,inputHash:report.after?.inputHash,output,deviceVerified:false}));
