import type {
  CallAudioFrame,
  CallAudioSpeakerRole,
  CallSpeechPipeline,
  CallTranslationControlPipeline,
  CallTtsAudioSink,
  SpeechPipelineMode,
  SpeechToSpeechProvider,
  TtsVoiceConfig,
} from "./types.js";

export interface SpeechPipelineRouterOptions {
  mode: SpeechPipelineMode;
  cascade: CallSpeechPipeline;
  native?: SpeechToSpeechProvider;
  onShadowError?: (error: unknown) => void;
}

export class SpeechPipelineRouter implements
CallSpeechPipeline, CallTranslationControlPipeline {
  private shadowChain: Promise<void> = Promise.resolve();

  constructor(private readonly options: SpeechPipelineRouterOptions) {
    if (options.mode !== "cascade" && !options.native) {
      throw new Error(`${options.mode} speech pipeline mode requires a provider`);
    }
  }

  async startCall(callId: string) {
    if (this.options.mode === "native") {
      await this.options.native!.startCall(callId);
      return;
    }
    await this.options.cascade.startCall(callId);
    if (this.options.mode === "shadow" && this.options.native) {
      this.enqueueShadow(() => this.options.native!.startCall(callId));
    }
  }

  async processAudioFrame(frame: CallAudioFrame) {
    if (this.options.mode === "native") {
      await this.options.native!.processAudioFrame(frame);
      return;
    }
    await this.options.cascade.processAudioFrame(frame);
    if (this.options.mode === "shadow" && this.options.native) {
      this.enqueueShadow(() => this.options.native!.processAudioFrame(frame));
    }
  }

  async flushSpeaker(callId: string, speakerRole: CallAudioSpeakerRole) {
    if (this.options.mode === "native") {
      await this.options.native!.flushSpeaker(callId, speakerRole);
      return;
    }
    await this.options.cascade.flushSpeaker(callId, speakerRole);
    if (this.options.mode === "shadow" && this.options.native) {
      this.enqueueShadow(() =>
        this.options.native!.flushSpeaker(callId, speakerRole)
      );
    }
  }

  async endCall(callId: string) {
    if (this.options.mode === "native") {
      await this.options.native!.endCall(callId);
      return;
    }
    await this.options.cascade.endCall(callId);
    if (this.options.mode === "shadow" && this.options.native) {
      await this.enqueueShadow(() => this.options.native!.endCall(callId));
    }
  }

  markCallEnded(callId: string) {
    if (this.options.mode !== "native") {
      this.options.cascade.markCallEnded?.(callId);
    }
    if (this.options.mode !== "cascade") {
      this.options.native?.markCallEnded?.(callId);
    }
  }

  addTtsAudioSink(sink: CallTtsAudioSink) {
    this.options.cascade.addTtsAudioSink(sink);
    this.options.native?.addTtsAudioSink(sink);
  }

  setTtsVoice(voice: TtsVoiceConfig) {
    this.options.cascade.setTtsVoice(voice);
    this.options.native?.setTtsVoice(voice);
  }

  setTranslatedUplinkPaused(callId: string, paused: boolean) {
    return this.controlPipeline().setTranslatedUplinkPaused(callId, paused);
  }

  processTypedText(
    input: Parameters<CallTranslationControlPipeline["processTypedText"]>[0],
  ) {
    return this.controlPipeline().processTypedText(input);
  }

  private controlPipeline() {
    if (this.options.mode === "native") {
      throw new Error("Translation controls require the cascade pipeline");
    }
    const pipeline = this.options.cascade as
      Partial<CallTranslationControlPipeline>;
    if (!pipeline.setTranslatedUplinkPaused || !pipeline.processTypedText) {
      throw new Error("Cascade translation controls are unavailable");
    }
    return pipeline as CallTranslationControlPipeline;
  }

  private enqueueShadow(operation: () => Promise<void>) {
    this.shadowChain = this.shadowChain.then(operation).catch((error) => {
      this.options.onShadowError?.(error);
    });
    return this.shadowChain;
  }
}
