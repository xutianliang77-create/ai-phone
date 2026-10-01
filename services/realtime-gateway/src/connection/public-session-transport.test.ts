import {EventEmitter} from 'node:events';
import type WebSocket from 'ws';
import {it,expect,vi} from 'vitest';
import {PublicSessionTransport} from './public-session-transport.js';
const protocols=['ai-phone.text-language.v1','ai-phone.speech-evidence.v1'];
function socket(){return Object.assign(new EventEmitter(),{readyState:1,send:vi.fn()}) as unknown as WebSocket;}
function response(raw:string){const {text,audioRange,...challenge}=JSON.parse(raw);return {...challenge,type:'text.language.result',
  evidence:'text_only_not_acoustic',dominant:'en',hypotheses:{en:0.99}};}
it('cancels old challenges without deadlocking the drain and binds new requests only to the authenticated successor',async()=>{
  const transport=new PublicSessionTransport('s',protocols,['en']),first=socket(),second=socket();
  transport.bind(first);const broker=transport.textLanguage!;
  const pending=broker.identify('old',1,'Hello everyone.'),old=vi.mocked(first.send).mock.calls[0][0] as string;
  first.emit('close');await expect(pending).resolves.toMatchObject({status:'unknown',reason:'unavailable'});
  await expect(broker.identify('detached',1,'Hello everyone.')).resolves.toMatchObject({status:'unknown'});
  transport.assertCapabilities(protocols);transport.bind(second);first.emit('error',Error('late old socket error'));
  const next=broker.identify('new',1,'Hello everyone.'),raw=vi.mocked(second.send).mock.calls[0][0] as string;
  expect(broker.accept(response(old))).toBe(false);expect(broker.accept(response(raw))).toBe(true);
  await expect(next).resolves.toMatchObject({status:'detected',language:'en'});
  expect(first.send).toHaveBeenCalledTimes(1);expect(second.send).toHaveBeenCalledTimes(1);
  transport.close();transport.bind(socket());await expect(broker.identify('ended',1,'Hello everyone.')).resolves.toMatchObject({status:'unknown'});
});
it('preserves the timeline object and refuses capability downgrade rather than dropping speech evidence',()=>{
  const transport=new PublicSessionTransport('s',protocols,['en']),first=socket(),second=socket();
  transport.bind(first);const timeline=transport.speakerTimeline(first,()=>{},{} as never);
  expect(()=>transport.assertCapabilities(['ai-phone.text-language.v1'])).toThrow('capability_mismatch');
  transport.bind(second);expect(transport.speakerTimeline(second,()=>{},{} as never)).toBe(timeline);
  expect(()=>transport.speakerTimeline(first,()=>{},{} as never)).toThrow('transport_changed');transport.close();
});
