import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import type {WebSocket} from 'ws';
import {createSession,confirmSessionConnection,transitionStatus,sessionBillableSeconds,deleteSession} from '../sessions/session-manager.js';
import type {RealtimeSession} from '../sessions/realtime-session.js';
import {bindControlBudget,controlBudgetExhausted} from './control-budget.js';
import {createUsageTickDecision} from '../usage/usage-ticker.js';
describe('control reservation bounds admitted audio and trusted meter',()=>{
 let session:RealtimeSession;
 beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(1800000000000);vi.stubEnv('V10_CONTROL_AUTHORITY','cloudflare');
  session=createSession({sessionId:'v10-budget-'+Math.random(),userId:'owner',issuedAt:1800000000,expiresAt:1800000300,
   sourceLanguage:'zh',targetLanguage:'en',voiceOutput:false,planCode:'fixture',maxDurationSeconds:31,holdSeconds:31,
   control:{contractVersion:1,execution:'retained_v10_processing',ownerId:'owner',deploymentId:'wujie-v10-fixture',devicePublicKey:'fixture',deviceKeyHash:'a'.repeat(64),planHash:'b'.repeat(64),bindingHash:'c'.repeat(64),expiresAtMs:Date.now()+91000}});
  confirmSessionConnection(session.id,1);
 });
 afterEach(()=>{session.providerCloseConfirmed=true;deleteSession(session.id);vi.useRealTimers();vi.unstubAllEnvs();});
 it('uses actual active time; a 30 second UI tick cannot overrun a 31 second reservation',()=>{
  vi.advanceTimersByTime(29700);expect(createUsageTickDecision(session).event.billableSeconds).toBe(30);
  vi.advanceTimersByTime(1700);expect(controlBudgetExhausted(session)).toBe(true);
  transitionStatus(session.id,'ending');expect(session.accumulatedActiveMs).toBe(31000);expect(sessionBillableSeconds(session)).toBe(31);
 });
 it('pausing preserves active budget but never extends the absolute lease',()=>{
  vi.advanceTimersByTime(10000);transitionStatus(session.id,'paused');vi.advanceTimersByTime(80000);
  expect(controlBudgetExhausted(session)).toBe(false);vi.advanceTimersByTime(1000);
  expect(controlBudgetExhausted(session)).toBe(true);expect(sessionBillableSeconds(session)).toBe(10);
 });
 it('stops at the active budget without another balance read and disposes on close',()=>{
  const socket=new EventEmitter(),stop=vi.fn();bindControlBudget(socket as WebSocket,session,stop);
  vi.advanceTimersByTime(31000);expect(stop).toHaveBeenCalledOnce();vi.advanceTimersByTime(5000);expect(stop).toHaveBeenCalledOnce();socket.emit('close');
 });
});
