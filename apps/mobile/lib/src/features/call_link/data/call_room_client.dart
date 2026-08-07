import 'call_link_api_client.dart';
import '../../../shared/domain/speaker_attribution.dart';

enum CallRoomConnectionStatus {
  disconnected,
  connecting,
  connected,
  reconnecting,
}

enum CallRoomConversationState {
  idle,
  listening,
  endpointing,
  thinking,
  speaking,
  interrupted,
}

enum CallRoomPlaybackState {
  idle,
  queued,
  started,
  ended,
  interrupted,
  failed,
}

class CallRoomSnapshot {
  const CallRoomSnapshot({
    required this.status,
    required this.microphoneEnabled,
    required this.remoteParticipantCount,
    this.microphonePausedForPlayback = false,
    this.message,
    this.captions = const <CallRoomCaption>[],
    this.conversationState = CallRoomConversationState.idle,
    this.playbackState = CallRoomPlaybackState.idle,
    this.activePlaybackId,
    this.pipelineGeneration,
    this.lastEventType,
  });

  final CallRoomConnectionStatus status;
  final bool microphoneEnabled;
  final bool microphonePausedForPlayback;
  final int remoteParticipantCount;
  final String? message;
  final List<CallRoomCaption> captions;
  final CallRoomConversationState conversationState;
  final CallRoomPlaybackState playbackState;
  final String? activePlaybackId;
  final int? pipelineGeneration;
  final String? lastEventType;

  const CallRoomSnapshot.disconnected({String? message})
      : this(
          status: CallRoomConnectionStatus.disconnected,
          microphoneEnabled: false,
          microphonePausedForPlayback: false,
          remoteParticipantCount: 0,
          message: message,
          captions: const <CallRoomCaption>[],
          conversationState: CallRoomConversationState.idle,
          playbackState: CallRoomPlaybackState.idle,
        );

  CallRoomSnapshot copyWith({
    CallRoomConnectionStatus? status,
    bool? microphoneEnabled,
    bool? microphonePausedForPlayback,
    int? remoteParticipantCount,
    String? message,
    List<CallRoomCaption>? captions,
    CallRoomConversationState? conversationState,
    CallRoomPlaybackState? playbackState,
    String? activePlaybackId,
    int? pipelineGeneration,
    String? lastEventType,
    bool clearActivePlaybackId = false,
  }) {
    return CallRoomSnapshot(
      status: status ?? this.status,
      microphoneEnabled: microphoneEnabled ?? this.microphoneEnabled,
      microphonePausedForPlayback:
          microphonePausedForPlayback ?? this.microphonePausedForPlayback,
      remoteParticipantCount:
          remoteParticipantCount ?? this.remoteParticipantCount,
      message: message ?? this.message,
      captions: captions ?? this.captions,
      conversationState: conversationState ?? this.conversationState,
      playbackState: playbackState ?? this.playbackState,
      activePlaybackId: clearActivePlaybackId
          ? null
          : activePlaybackId ?? this.activePlaybackId,
      pipelineGeneration: pipelineGeneration ?? this.pipelineGeneration,
      lastEventType: lastEventType ?? this.lastEventType,
    );
  }
}

class CallRoomCaption {
  const CallRoomCaption({
    required this.segmentId,
    required this.speaker,
    required this.sourceLanguage,
    required this.targetLanguage,
    required this.timestampMs,
    this.sourceText,
    this.translatedText,
    this.ttsReady = false,
    this.ttsProvider,
    this.ttsModel,
    this.voiceMode,
    this.voiceProfileId,
    this.firstAudioMs,
    this.audioDurationMs,
    this.isPartial = false,
    this.isTranslationDelta = false,
    this.playbackState = CallRoomPlaybackState.idle,
    this.playbackId,
    this.generation,
  });

  final String segmentId;
  final SpeakerAttribution speaker;
  String get speakerRole => speaker.role;
  final String sourceLanguage;
  final String targetLanguage;
  final int timestampMs;
  final String? sourceText;
  final String? translatedText;
  final bool ttsReady;
  final String? ttsProvider;
  final String? ttsModel;
  final String? voiceMode;
  final String? voiceProfileId;
  final int? firstAudioMs;
  final int? audioDurationMs;
  final bool isPartial;
  final bool isTranslationDelta;
  final CallRoomPlaybackState playbackState;
  final String? playbackId;
  final int? generation;

  CallRoomCaption merge(CallRoomCaption next) {
    return CallRoomCaption(
      segmentId: segmentId,
      speaker: next.speaker,
      sourceLanguage: next.sourceLanguage,
      targetLanguage: next.targetLanguage,
      timestampMs: next.timestampMs,
      sourceText: _nonEmpty(next.sourceText) ?? sourceText,
      translatedText: _nonEmpty(next.translatedText) ?? translatedText,
      ttsReady: ttsReady || next.ttsReady,
      ttsProvider: _nonEmpty(next.ttsProvider) ?? ttsProvider,
      ttsModel: _nonEmpty(next.ttsModel) ?? ttsModel,
      voiceMode: _nonEmpty(next.voiceMode) ?? voiceMode,
      voiceProfileId: _nonEmpty(next.voiceProfileId) ?? voiceProfileId,
      firstAudioMs: next.firstAudioMs ?? firstAudioMs,
      audioDurationMs: next.audioDurationMs ?? audioDurationMs,
      isPartial: next.isPartial,
      isTranslationDelta: next.isTranslationDelta,
      playbackState: next.playbackState == CallRoomPlaybackState.idle
          ? playbackState
          : next.playbackState,
      playbackId: next.playbackId ?? playbackId,
      generation: next.generation ?? generation,
    );
  }

  static String? _nonEmpty(String? value) {
    final trimmed = value?.trim();
    return trimmed == null || trimmed.isEmpty ? null : trimmed;
  }
}

abstract class CallRoomClient {
  Stream<CallRoomSnapshot> get snapshots;

  Future<void> connect(
    CallRoomToken token, {
    bool enableMicrophone = true,
    bool translationMediaOnly = false,
  });

  Future<void> disconnect();

  Future<void> dispose();
}
