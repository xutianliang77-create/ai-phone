import type {WebSocket} from 'ws';
import type {RealtimeSession} from '../sessions/realtime-session.js';
import {detachUnadmittedControlSession} from '../sessions/session-manager.js';
import {proveSharedControlConnection} from './shared-control-proof.js';
import {sendRealtimeEvent} from './realtime-connection-admission.js';
import {buildError} from '../protocol/outgoing-event-builder.js';

export async function admitSharedControlDevice(ws:WebSocket,session:RealtimeSession,generation:number){
  try{await proveSharedControlConnection(ws,session);return true;}
  catch{
    detachUnadmittedControlSession(session,generation);
    sendRealtimeEvent(ws,buildError('invalid_token','Device proof was not confirmed',{sessionId:session.id,stage:'connection',retryable:false}));
    ws.close();return false;
  }
}
export function bindSharedControlExpiry(ws:WebSocket,session:RealtimeSession,end:()=>void){
  if(!session.claims.control)return;
  const timer=setTimeout(end,Math.max(1,session.claims.control.expiresAtMs-Date.now()));
  ws.once('close',()=>clearTimeout(timer));
}
