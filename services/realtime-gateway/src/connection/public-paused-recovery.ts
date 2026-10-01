import type {PublicRecoveryRuntime} from '../sessions/realtime-session.js';
import type {createPublicAdmissionClient} from '../sessions/public-admission-client.js';
import {retainPublicRecoveryRuntime,releasePublicRecoveryRuntime} from '../sessions/session-manager.js';

/** Eligibility is sampled BEFORE the disconnect observation changes phase.
 * Only a durable paused watermark may use the product's lifecycle recovery. */
export function publicRecoveryHooks(sessionId:string,generation:number,runtime:PublicRecoveryRuntime,
  admission:ReturnType<typeof createPublicAdmissionClient>,options:{recoverySocketAssembly?:boolean;pausedLifecycleRecovery?:boolean}){
  let retain=false;
  return {
    checkpointDisconnect:async()=>{
      runtime.pausedLifecycle=runtime.sessionEventSink.canRetainPaused();
      retain=options.recoverySocketAssembly===true||options.pausedLifecycleRecovery===true&&runtime.pausedLifecycle;
      await runtime.sessionEventSink.disconnect();await runtime.sessionEventSink.drain();
      return admission.inspectRecovery();
    },
    retainPublicRecovery:()=>retain&&retainPublicRecoveryRuntime(sessionId,generation,runtime),
    releaseRetainedRecovery:()=>releasePublicRecoveryRuntime(sessionId,generation),
  };
}
