/** Logs protocol state only. Never serialize supplier bodies, text or audio. */
const wireTypes=new Set([
  "session.created","session.updated","session.finished","error",
  "input_audio_buffer.speech_started","input_audio_buffer.speech_stopped",
  "input_audio_buffer.committed","conversation.item.created",
  "conversation.item.input_audio_transcription.text",
  "conversation.item.input_audio_transcription.delta",
  "conversation.item.input_audio_transcription.completed",
  "conversation.item.input_audio_transcription.failed",
]);
export function streamingAsrFailureDiagnostic(code:string,eventType:unknown,uploadedSamples:number,language?:unknown){
  return {
    code:/^[a-z0-9_]{1,120}$/.test(code)?code:"public_asr_stream_unclassified",
    eventType:typeof eventType==="string"&&wireTypes.has(eventType)?eventType:"unknown",
    uploadedSamples:Number.isSafeInteger(uploadedSamples)&&uploadedSamples>=0?uploadedSamples:0,
    ...(typeof language==="string"&&/^[a-z]{2,3}$/.test(language)?{language}:{}),
  };
}
