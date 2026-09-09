import type { AudioFrame, PublicRuntimeObservation, ServerRealtimeEvent,PublicModelAttemptEvent } from "@translation/contracts";
import type { SessionEventSink } from "./session-event-sink.js";
import { cleanRealtimeText } from "../protocol/realtime-text.js";
import {markAcceptedAudioRange} from "../connection/accepted-audio-range.js";

export interface PublicSessionBinding {
  sessionId:string; deploymentId:string; ownerId:string; modelPolicyRevision:string;
  leaseId:string; captureId:string; languagePolicyKey:string;
  sampleRate:16000|24000;
}

/** Per-session serializer in the original sink path; no models, timers or persistence engine.
 * A failed/uncertain receipt halts subsequent writes. Reconciliation uses S3 recovery,
 * not a new producer starting again at sequence one. */
export class PublicSessionEventSink implements SessionEventSink {
  readonly requiresConfirmation=true as const;
  private readonly binding:Readonly<PublicSessionBinding>;
  private queue=Promise.resolve();
  private pending=0;
  private failure:Error|undefined;
  private sequence=0;
  private phase:PublicRuntimeObservation["phase"]|undefined;
  private samples=0;
  private frameSequence=-1;
  private revision=0;
  private startPromise?:Promise<void>;
  private stopPromise?:Promise<void>;
  constructor(private readonly sink:SessionEventSink,binding:PublicSessionBinding) {
    if(!sink.runtime)throw Error("public_runtime_sink_required");
    for(const value of [binding.sessionId,binding.deploymentId,binding.ownerId,binding.modelPolicyRevision,
      binding.leaseId,binding.captureId,binding.languagePolicyKey]){
      if(typeof value!=="string"||!value||value.length>240||value.trim()!==value)throw Error("invalid_public_session_binding");
    }
    if(![16000,24000].includes(binding.sampleRate))throw Error("invalid_public_sample_rate");
    this.binding=Object.freeze({...binding});
  }

  /** Call only when the original transport accepts this PCM frame, before processing.
   * The watermark counts received samples, not model-consumed audio or client time. */
  acceptAudio(frame:AudioFrame) {
    this.assertOpen();this.assertSession(frame.sessionId);
    if(this.phase!=="active")throw Error("public_runtime_not_active");
    if(frame.format!=="pcm16"||frame.sampleRate!==this.binding.sampleRate||
        !Number.isSafeInteger(frame.sequence)||frame.sequence<=this.frameSequence)throw Error("invalid_public_audio_frame");
    const pcm=Buffer.from(frame.data,"base64");
    if(!pcm.length||pcm.length%2!==0||pcm.toString("base64")!==frame.data||
        !Number.isSafeInteger(this.samples+pcm.length/2))throw Error("invalid_public_audio_frame");
    markAcceptedAudioRange(frame,{startSample:this.samples,endSample:this.samples+pcm.length/2});
    this.samples+=pcm.length/2;this.frameSequence=frame.sequence;
  }

  record(event:ServerRealtimeEvent):Promise<void> {
    if(!("sessionId" in event))return Promise.reject(Error("public_event_session_required"));
    if(event.sessionId!==this.binding.sessionId)return Promise.reject(Error("public_event_session_mismatch"));
    if(event.type==="session.started"){
      if(this.stopPromise)return Promise.reject(Error("public_runtime_stopped"));
      this.startPromise??=this.enqueue(()=>this.observe("active",0,true));
      return this.startPromise;
    }
    if(event.type==="session.ended"){
      if(this.stopPromise)return this.stopPromise;
      const samples=this.samples;
      this.stopPromise=this.enqueue(()=>this.observe("stopped",samples));
      return this.stopPromise;
    }
    const samples=this.samples;
    if(event.type==="session.paused"||event.type==="session.resumed"){
      const phase=event.type==="session.paused"?"paused":"active";
      return this.enqueue(()=>this.observe(phase,samples));
    }
    if(!["transcript.final","translation.final","translation.failed","speaker.updated"].includes(event.type)) {
      return this.failure?Promise.reject(this.failure):Promise.resolve();
    }
    const snapshot=structuredClone(event);
    return this.enqueue(async()=>{
      if(!this.phase)throw Error("public_runtime_not_started");
      const revision="revision" in snapshot?snapshot.revision??0:0;
      if(!Number.isSafeInteger(revision)||Number(revision)<0)throw Error("invalid_public_revision");
      if((snapshot.type==="transcript.final"||snapshot.type==="translation.final")&&!cleanRealtimeText(snapshot.text))return;
      await this.sink.record(snapshot);
      this.revision=Math.max(this.revision,Number(revision));
    });
  }

  touch(sessionId:string,status:"active"|"paused") {
    if(sessionId!==this.binding.sessionId)return Promise.reject(Error("public_event_session_mismatch"));
    const samples=this.samples;
    return this.enqueue(async()=>{
      if(this.phase!==status)throw Error("public_heartbeat_phase_mismatch");
      await this.observe(status,samples);
    });
  }

  confirmAudio(){
    const samples=this.samples;
    return this.enqueue(async()=>{
      if(this.phase!=="active"&&this.phase!=="paused")throw Error("public_runtime_not_started");
      await this.observe(this.phase,samples);
    });
  }
  async modelAttempt(event:PublicModelAttemptEvent){
    this.assertSession(event.sessionId);
    if(event.leaseId!==this.binding.leaseId||!this.sink.modelAttempt)throw Error("public_model_attempt_binding_required");
    if(event.state==="dispatching")await this.confirmAudio();
    await this.sink.modelAttempt(structuredClone(event));
  }
  disconnect() {
    const samples=this.samples;
    return this.enqueue(async()=>{if(this.phase!=="disconnected")await this.observe("disconnected",samples);});
  }
  drain(){return this.queue.then(()=>{if(this.failure)throw this.failure;});}

  private assertOpen(){if(this.failure)throw this.failure;if(this.stopPromise)throw Error("public_runtime_stopped");}
  private assertSession(id:string){if(id!==this.binding.sessionId)throw Error("public_event_session_mismatch");}
  private enqueue(run:()=>Promise<void>):Promise<void> {
    try{this.assertOpen();}catch(error){return Promise.reject(error);}
    if(this.pending>=32){this.failure=Error("public_runtime_queue_full");return Promise.reject(this.failure);}
    this.pending++;
    const task=this.queue.then(async()=>{if(this.failure)throw this.failure;await run();});
    this.queue=task.catch(()=>{this.failure??=Error("public_runtime_unconfirmed");}).finally(()=>{this.pending--;});
    return task;
  }
  private async observe(phase:PublicRuntimeObservation["phase"],samples:number,starting=false) {
    if(starting?this.phase!==undefined:!this.phase||this.phase==="stopped")throw Error("public_runtime_phase_conflict");
    if(phase==="paused"&&this.phase!=="active"&&this.phase!=="paused")throw Error("public_runtime_phase_conflict");
    const event:PublicRuntimeObservation={leaseId:this.binding.leaseId,captureId:this.binding.captureId,
      languagePolicyKey:this.binding.languagePolicyKey,sequence:this.sequence+1,phase,
      finalRevision:this.revision,lastAcceptedSample:samples};
    const ack=await this.sink.runtime!(this.binding.sessionId,event);
    if(ack.sessionId!==this.binding.sessionId||ack.deploymentId!==this.binding.deploymentId||
      ack.ownerId!==this.binding.ownerId||ack.modelPolicyRevision!==this.binding.modelPolicyRevision||
      Object.entries(event).some(([key,value])=>ack[key as keyof typeof ack]!==value)||ack.meterStatus!=="verified") {
      throw Error("public_runtime_unconfirmed");
    }
    this.sequence=event.sequence;this.phase=phase;
  }
}
