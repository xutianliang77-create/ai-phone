import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import type {WebSocket} from 'ws';
import {bindOperationalDeadline,requireOperationalAdmission} from './self-hosted-deadline.js';
describe('self hosted absolute QA deadline',()=>{
 beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(1800000000000);vi.stubEnv('AUTH_PROVIDER','apple');vi.stubEnv('REALTIME_TOKEN_SECRET','fixture-runtime-signing-secret-32b');vi.stubEnv('INTERNAL_API_SECRET','fixture-internal-signing-secret-32b');vi.stubEnv('V10_SERVICE_ADMISSION_ENABLED','true');vi.stubEnv('V10_SERVICE_WINDOW_STARTS_AT',new Date(Date.now()).toISOString());vi.stubEnv('V10_SERVICE_WINDOW_ENDS_AT',new Date(Date.now()+1000).toISOString());});
 afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
 it('ends the connected session at the exact deadline and does not renew it',()=>{
  const stop=vi.fn(),ws=new EventEmitter();bindOperationalDeadline(ws as WebSocket,stop);
  vi.advanceTimersByTime(999);expect(stop).not.toHaveBeenCalled();vi.advanceTimersByTime(1);expect(stop).toHaveBeenCalledTimes(1);
  expect(()=>requireOperationalAdmission()).toThrow('service_admission_closed');vi.advanceTimersByTime(5000);expect(stop).toHaveBeenCalledTimes(1);
 });
 it('cancels the deadline timer when the connection has already closed',()=>{
  const stop=vi.fn(),ws=new EventEmitter();bindOperationalDeadline(ws as WebSocket,stop);ws.emit('close');vi.advanceTimersByTime(2000);expect(stop).not.toHaveBeenCalled();
 });
});
