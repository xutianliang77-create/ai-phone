import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ios = 'apps/mobile/ios/Runner/';
const render = ['VoiceProcessingPcmPlayer.swift','PcmRenderClock.swift','PcmRenderReference.swift'].map(p=>ios+p);
const suite = (id, sources, test, args=[]) => ({id,sources:[...sources,'scripts/tests/'+test],args});
export const nativeAudioSuites = [
  suite('render-clock',[...render,ios+'PcmRenderTap.swift'],'pcm_render_clock_test.swift'),
  suite('sample-clock',render,'pcm_render_sample_clock_test.swift'),
  suite('pcm-player',[...render,ios+'PublicPcmMailbox.swift'],'voice_processing_pcm_player_test.swift'),
  suite('capture-ownership',[ios+'CaptureEngineInvalidationGate.swift'],'capture_engine_invalidation_test.swift'),
  suite('vad-onset',[ios+'CoreMlNemotronEndpointDetector.swift'],'online_vad_speech_start_test.swift'),
  suite('duplex-metadata',[...render,ios+'CoreMlNemotronEndpointDetector.swift'],'ios_duplex_metadata_test.swift',
    ['scripts/tests/fixtures/ios-duplex-3008-metadata.json']),
];
export const nativeAudioInputs = [...new Set([
  ...nativeAudioSuites.flatMap(s=>[...s.sources,...s.args]),
  ...['CoreMlNemotronAudioInput.swift','PublicPcmCaptureBridge.swift','AppleOnlineEndpointSession.swift','SpeechOutputBridge.swift'].map(p=>ios+p),
  'apps/mobile/lib/src/features/realtime/presentation/controllers/realtime_controller_audio_input.dart',
  'scripts/check_ios_native_audio.mjs','scripts/lib/ios_native_audio_gate.mjs',
])].sort();
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const nativeAudioWiringChecks = [
  ['resume-graph',ios+'CoreMlNemotronAudioInput.swift','guardstate.graphReadyForResume'],
  ['reference-installed',ios+'CoreMlNemotronAudioInput.swift','referenceBound:pcmPlayback!=nil&&(renderTap?.installed??true)'],
  ['input-clock-separate',ios+'CoreMlNemotronAudioInput.swift','inputClockReady:renderTap?.ready??true'],
  ['first-real-pcm',ios+'PublicPcmCaptureBridge.swift','ifself.pendingStart!=nil,letinput=self.input,input.pcmReadiness.ready'],
  ['valid-render-time',ios+'PcmRenderTap.swift','time.isSampleTimeValid&&time.sampleRate==rate?time.sampleTime:nil'],
  ['render-time-forwarded',ios+'PcmRenderTap.swift','generation:self.generation,sampleTime:sampleTime'],
  ['render-time-consumed',ios+'PcmRenderReference.swift','clock.position(at:stamp.hostTime,sampleRate:captureRate)'],
  ['echo-aware-onset',ios+'AppleOnlineEndpointSession.swift','speechStartAllowed:echoDecision.speechStartAllowed'],
  ['no-normal-chunk-stop',ios+'SpeechOutputBridge.swift','ifPcmPlaybackBoundary.shouldStopBeforePlay'],
  ['dart-barge-stop','apps/mobile/lib/src/features/realtime/presentation/controllers/realtime_controller_audio_input.dart',
    'if(frame.startsSegment&&(_speechCaptureGate.isPlaying||_publicAudioRevisionBySegment.isNotEmpty))unawaited(_stopSpeaking());'],
];
export function checkNativeAudioWiring(readSource) {
  const source=p=>readSource(p).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g,'').replace(/\s+/g,'');
  for(const[id,file,token]of nativeAudioWiringChecks)if(!source(file).includes(token))throw Error('native audio wiring changed: '+id);
  const play=source(ios+'SpeechOutputBridge.swift').split('privatefuncplayPcm(')[1];
  if(!play||play.split('ifPcmPlaybackBoundary.shouldStopBeforePlay')[0].includes('stop()'))throw Error('unconditional playback reset');
  return nativeAudioWiringChecks.map(([id])=>id);
}
export function nativeAudioSnapshot(root) {
  const git = (...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  const files = nativeAudioInputs.map(p=>[p,sha256(readFileSync(path.join(root,p)))]);
  return {sourceCommit:git('rev-parse','HEAD'),sourceTree:git('rev-parse','HEAD^{tree}'),
    sourceState:git('status','--porcelain=v1','--untracked-files=all')?'dirty':'clean',
    files,inputHash:sha256(JSON.stringify(files))};
}
export function validateNativeAudioReport(report, expected) {
  const fail = why=>{throw Error('iOS native audio gate: '+why);};
  if(report.schemaVersion!==1||report.status!=='HOST_PASS'||report.platform!=='darwin'||report.usesMicrophone!==false||report.modelCalls!==0)fail('successful offline macOS receipt required');
  if(JSON.stringify(report.wiring)!==JSON.stringify(nativeAudioWiringChecks.map(([id])=>id)))fail('production wiring checks required');
  if(!/^[a-f0-9]{40}$/.test(expected.sourceCommit??'')||!/^[a-f0-9]{40}$/.test(expected.sourceTree??''))fail('source identity required');
  for(const snapshot of [report.before,report.after]) {
    if(!snapshot||snapshot.sourceCommit!==expected.sourceCommit||snapshot.sourceTree!==expected.sourceTree||snapshot.sourceState!=='clean'||
      snapshot.inputHash!==expected.inputHash||JSON.stringify(snapshot.files)!==JSON.stringify(expected.files))fail('stale, dirty or changed source');
  }
  if(report.suites?.length!==nativeAudioSuites.length)fail('all native suites required');
  for(const [i,suite] of nativeAudioSuites.entries()) {
    const actual=report.suites[i];
    if(actual?.id!==suite.id||actual.compile?.exitCode!==0||actual.run?.exitCode!==0||
      actual.compile.signal||actual.run.signal||actual.compile.error||actual.run.error)fail('suite failed or missing: '+suite.id);
  }
  return true;
}
export function verifyIosNativeAudioEvidence(file, {root,sourceCommit,sourceTree}) {
  const bytes=readFileSync(file),report=JSON.parse(bytes),current=nativeAudioSnapshot(root);
  if(current.sourceCommit!==sourceCommit||current.sourceTree!==sourceTree||current.sourceState!=='clean')throw Error('candidate source is not clean/current');
  validateNativeAudioReport(report,current);
  return {status:'HOST_PASS',file:path.basename(file),sha256:sha256(bytes),inputHash:current.inputHash,
    suiteCount:nativeAudioSuites.length,deviceVerified:false};
}
