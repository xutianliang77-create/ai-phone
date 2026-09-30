import { describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeAudioSnapshot, nativeAudioSuites, validateNativeAudioReport } from './ios_native_audio_gate.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=p=>readFileSync(path.join(root,p),'utf8'),compact=p=>read(p).replace(/\s+/g,'');
const expected={...nativeAudioSnapshot(root),sourceState:'clean'};
function valid(){return {schemaVersion:1,status:'HOST_PASS',platform:'darwin',usesMicrophone:false,modelCalls:0,
 before:structuredClone(expected),after:structuredClone(expected),
 suites:nativeAudioSuites.map(s=>({id:s.id,compile:{exitCode:0,signal:null,error:null},run:{exitCode:0,signal:null,error:null}}))};}

describe('iOS native audio mandatory gate',()=>{
 it('accepts the full clean same-source receipt, not a DEVICE assertion',()=>{
   expect(validateNativeAudioReport(valid(),expected)).toBe(true);
   expect(nativeAudioSuites.map(s=>s.id)).toEqual(['render-clock','sample-clock','pcm-player','capture-ownership','vad-onset','duplex-metadata']);
 });
 const mutations={
   failed:r=>{r.status='FAIL';},unsupported:r=>{r.platform='linux';},microphone:r=>{r.usesMicrophone=true;},model:r=>{r.modelCalls=1;},
   dirty:r=>{r.before.sourceState='dirty';},oldCommit:r=>{r.before.sourceCommit='0'.repeat(40);},oldTree:r=>{r.after.sourceTree='0'.repeat(40);},
   changed:r=>{r.after.inputHash='0'.repeat(64);},wrongFiles:r=>{r.before.files=[];},skipped:r=>{r.suites.pop();},
   duplicate:r=>{r.suites[1]=r.suites[0];},compile:r=>{r.suites[0].compile.exitCode=1;},
   run:r=>{r.suites[0].run.exitCode=1;},signal:r=>{r.suites[0].run.signal='SIGTERM';},spawn:r=>{r.suites[0].compile.error='ENOENT';},
 };
 for(const[name,mutate]of Object.entries(mutations))it('rejects '+name+' evidence',()=>{
   const r=valid();mutate(r);expect(()=>validateNativeAudioReport(r,expected)).toThrow();
 });
 it('returns nonzero and records failure when the compiler/toolchain is unavailable',()=>{
   const temp=mkdtempSync(path.join(tmpdir(),'wujie-native-gate-negative-'));
   try{
     const output=path.join(temp,'receipt.json');
     const r=spawnSync(process.execPath,[path.join(root,'scripts/check_ios_native_audio.mjs'),'--output',output],
       {cwd:root,env:{PATH:''},encoding:'utf8',timeout:15000});
     expect(r.status).not.toBe(0);
     expect(JSON.parse(readFileSync(output)).status).toBe('FAIL');
   }finally{rmSync(temp,{recursive:true,force:true});}
 });
 it('runs before candidate compilation and binds the receipt in the candidate manifest',()=>{
   const build=read('scripts/build_traceable_ios_candidate.sh');
   const at=build.indexOf('node "$ROOT_DIR/scripts/check_ios_native_audio.mjs"');
   expect(at).toBeGreaterThan(0);expect(at).toBeLessThan(build.indexOf('flutter build ios'));
   expect(build).toContain('--output "$OUTPUT_ROOT/native-audio-regression.json"');
   expect(read('scripts/lib/write_ios_candidate_manifest.mjs')).toContain('nativeAudioRegression: verifyIosNativeAudioEvidence(');
   expect(build).not.toContain('SKIP_NATIVE_AUDIO');
 });
 it('uses a pinned-action macOS CI lane with no production secrets or device operations',()=>{
   const workflow=read('.github/workflows/ios-native-audio.yml');
   expect(workflow).toContain('runs-on: macos-latest');
   expect(workflow).toContain('npm run check:ios-native-audio');
   expect(workflow).toContain('contents: read');
   expect(workflow).toContain('persist-credentials: false');
   expect(workflow).not.toContain('secrets.');expect(workflow).not.toContain('continue-on-error');
   expect(workflow).not.toContain('devicectl');
   for(const [,action]of workflow.matchAll(/uses:\s*([^\s#]+)/g))expect(action).toMatch(/@[a-f0-9]{40}$/);
   expect(JSON.parse(read('package.json')).scripts['check:ios-native-audio']).toBe('node scripts/check_ios_native_audio.mjs');
 });
 it('retains the production call sites that previously regressed',()=>{
   const input=compact('apps/mobile/ios/Runner/CoreMlNemotronAudioInput.swift');
   expect(input).toContain('guardstate.graphReadyForResume');
   expect(input).toContain('referenceBound:pcmPlayback!=nil&&(renderTap?.installed??true)');
   expect(input).toContain('inputClockReady:renderTap?.ready??true');
   expect(compact('apps/mobile/ios/Runner/PublicPcmCaptureBridge.swift')).toContain('input.pcmReadiness.ready');
   const tap=compact('apps/mobile/ios/Runner/PcmRenderTap.swift');
   expect(tap).toContain('time.isSampleTimeValid&&time.sampleRate==rate?time.sampleTime:nil');
   expect(tap).toContain('generation:self.generation,sampleTime:sampleTime');
   expect(compact('apps/mobile/ios/Runner/PcmRenderReference.swift')).toContain('renderClock.stamp(sampleTime:sampleTime');
   expect(compact('apps/mobile/ios/Runner/AppleOnlineEndpointSession.swift')).toContain('speechStartAllowed:echoDecision.speechStartAllowed');
   const playback=read('apps/mobile/ios/Runner/SpeechOutputBridge.swift').split('private func playPcm(')[1];
   expect(playback).toContain('if PcmPlaybackBoundary.shouldStopBeforePlay');
   expect(playback.split('if PcmPlaybackBoundary.shouldStopBeforePlay')[0]).not.toContain('stop()');
   expect(read('apps/mobile/lib/src/features/realtime/presentation/controllers/realtime_controller_audio_input.dart'))
     .toMatch(/if \(frame\.startsSegment[\s\S]{0,160}_stopSpeaking\(\)/);
 });
});
