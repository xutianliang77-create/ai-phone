import type WebSocket from 'ws';
import {DEVICE_TEXT_LANGUAGE_PROTOCOL,DEVICE_SPEECH_EVIDENCE_PROTOCOL,type ServerRealtimeEvent,type TranslationLanguageCode} from '@translation/contracts';
import {DeviceTextLanguageBroker} from './device-text-language.js';
import {sendRealtimeEvent} from './realtime-connection-admission.js';
import {getSession} from '../sessions/session-manager.js';
import {DeviceSpeakerTimeline} from '../speaker/device-speaker-timeline.js';
import type {RealtimeProvider} from '../providers/realtime-provider.js';

/** Same-session callbacks survive a confirmed-pause socket replacement. No
 * pending challenge or old socket is allowed to write into its successor. */
export class PublicSessionTransport {
  readonly textLanguage?:DeviceTextLanguageBroker;
  private socket?:WebSocket;
  private dispatch?:(event:ServerRealtimeEvent)=>void;
  private timeline?:DeviceSpeakerTimeline;
  private readonly capabilities:readonly boolean[];
  constructor(private readonly sessionId:string,protocols:readonly string[],sources:readonly TranslationLanguageCode[]){
    this.capabilities=this.readCapabilities(protocols);
    if(this.capabilities[0])this.textLanguage=new DeviceTextLanguageBroker(sessionId,sources,
      event=>{if(this.socket?.readyState!==1)return false;sendRealtimeEvent(this.socket,event);return true;},2000,this.capabilities[1]);
  }
  assertCapabilities(protocols:readonly string[]){
    if(this.readCapabilities(protocols).some((value,i)=>value!==this.capabilities[i]))throw Error('public_recovery_capability_mismatch');
  }
  bind(socket:WebSocket){
    this.socket=socket;this.dispatch=undefined;this.textLanguage?.resumeTransport();
    const detach=()=>{if(this.socket!==socket)return;this.socket=undefined;this.dispatch=undefined;this.textLanguage?.disconnectTransport();};
    socket.once('close',detach);socket.once('error',detach);
  }
  preview=(event:ServerRealtimeEvent)=>{
    if(this.socket?.readyState===1&&getSession(this.sessionId)?.status==='active')sendRealtimeEvent(this.socket,event);
  };
  speakerTimeline(socket:WebSocket,send:(event:ServerRealtimeEvent)=>void,provider:RealtimeProvider){
    if(this.socket!==socket)throw Error('public_recovery_transport_changed');
    this.dispatch=send;
    this.timeline??=new DeviceSpeakerTimeline(this.sessionId,event=>this.dispatch?.(event),
      ()=>provider.deviceSpeakerBoundaryGuards?.(this.sessionId)??[]);
    return this.timeline;
  }
  close(){this.textLanguage?.close();this.socket=undefined;this.dispatch=undefined;}
  private readCapabilities(protocols:readonly string[]){
    return [protocols.includes(DEVICE_TEXT_LANGUAGE_PROTOCOL),protocols.includes(DEVICE_SPEECH_EVIDENCE_PROTOCOL)];
  }
}
