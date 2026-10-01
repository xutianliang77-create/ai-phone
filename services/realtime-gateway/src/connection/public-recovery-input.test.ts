import {it,expect,vi} from 'vitest';
import {PublicRecoveryInput} from './public-recovery-input.js';
it('consumes the bridge once, requires durable resume and exact first audio, then allows ordinary pause/resume',()=>{
  const send=vi.fn(),bridge={lastAcceptedSample:1600,nextSequence:2},input=new PublicRecoveryInput('s',bridge,send);
  const event=(type:string,fields={})=>({type,sessionId:'s',...fields} as never);
  expect(input.accept(event('session.resume',{recovery:{...bridge,lastAcceptedSample:0}}))).toBe(false);
  expect(input.accept(event('session.resume',{recovery:bridge}))).toBe(true);
  expect(input.accept(event('session.resume',{recovery:bridge}))).toBe(false);
  expect(input.accept(event('audio.frame',{sequence:2}))).toBe(false);input.confirm();
  expect(input.accept(event('audio.frame',{sequence:3}))).toBe(false);
  expect(input.accept(event('audio.frame',{sequence:2}))).toBe(true);input.acceptedAudio();
  expect(input.accept(event('session.resume',{recovery:bridge}))).toBe(false);
  expect(input.accept(event('session.pause'))).toBe(true);expect(input.accept(event('session.resume'))).toBe(true);
  expect(input.accept(event('audio.frame',{sequence:3}))).toBe(true);
  expect(input.accept(event('session.resume',{sessionId:'other'}))).toBe(false);
});
it('permits explicit end before completing the bridge without admitting audio or control mutations',()=>{
  const input=new PublicRecoveryInput('s',{lastAcceptedSample:1,nextSequence:2},()=>{});
  expect(input.accept({type:'session.end',sessionId:'s'})).toBe(true);
  for(const type of ['audio.frame','audio.boundary','audio.speech_started','session.voice_output','session.pause']){
    expect(input.accept({type,sessionId:'s'} as never)).toBe(false);
  }
});
