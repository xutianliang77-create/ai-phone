export interface PublicModelAttemptEvent {
  sessionId:string;leaseId:string;attemptId:string;segmentId:string;revision:number;
  component:"translation"|"asr"|"tts";providerId:string;modelId:string;
  audioStartSample?:number;audioEndSample?:number;audioSampleRate?:16000|24000;
  /** dispatching is durable intent: a crash may occur before or after actual send. */
  state:"dispatching"|"confirmed"|"rejected"|"not_sent"|"uncertain";
  failureCode?:string;
  metadata?:{requestId?:string;reportedModel?:string;usage?:{promptTokens?:number;completionTokens?:number;totalTokens?:number;thoughtTokens?:number;cachedPromptTokens?:number;audioInputTokens?:number;textInputTokens?:number;audioSeconds?:number;billedCharacters?:number;audioOutputTokens?:number}};
}
export interface PublicModelAttemptAck {event:PublicModelAttemptEvent;recordedAt:string;costStatus:"unknown";}
/** Canonical identity for this bounded metadata contract, independent of JSON key order. */
export function modelAttemptKey(e:PublicModelAttemptEvent){return JSON.stringify([
  e.sessionId,e.leaseId,e.attemptId,e.segmentId,e.revision,e.component,e.providerId,e.modelId,e.state,e.failureCode??null,
  e.metadata?.requestId??null,e.metadata?.reportedModel??null,e.metadata?.usage?.promptTokens??null,
  e.metadata?.usage?.completionTokens??null,e.metadata?.usage?.totalTokens??null,e.metadata?.usage?.thoughtTokens??null,e.metadata?.usage?.cachedPromptTokens??null,
  e.audioStartSample??null,e.audioEndSample??null,e.audioSampleRate??null,e.metadata?.usage?.audioInputTokens??null,e.metadata?.usage?.textInputTokens??null,e.metadata?.usage?.audioSeconds??null,
  e.metadata?.usage?.billedCharacters??null,e.metadata?.usage?.audioOutputTokens??null]);}
