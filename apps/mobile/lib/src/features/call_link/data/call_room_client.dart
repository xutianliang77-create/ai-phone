import 'call_link_api_client.dart';

enum CallRoomConnectionStatus {
  disconnected,
  connecting,
  connected,
  reconnecting,
}

class CallRoomSnapshot {
  const CallRoomSnapshot({
    required this.status,
    required this.microphoneEnabled,
    required this.remoteParticipantCount,
    this.message,
    this.captions = const <CallRoomCaption>[],
  });

  final CallRoomConnectionStatus status;
  final bool microphoneEnabled;
  final int remoteParticipantCount;
  final String? message;
  final List<CallRoomCaption> captions;

  const CallRoomSnapshot.disconnected({String? message})
      : this(
          status: CallRoomConnectionStatus.disconnected,
          microphoneEnabled: false,
          remoteParticipantCount: 0,
          message: message,
          captions: const <CallRoomCaption>[],
        );

  CallRoomSnapshot copyWith({
    CallRoomConnectionStatus? status,
    bool? microphoneEnabled,
    int? remoteParticipantCount,
    String? message,
    List<CallRoomCaption>? captions,
  }) {
    return CallRoomSnapshot(
      status: status ?? this.status,
      microphoneEnabled: microphoneEnabled ?? this.microphoneEnabled,
      remoteParticipantCount:
          remoteParticipantCount ?? this.remoteParticipantCount,
      message: message ?? this.message,
      captions: captions ?? this.captions,
    );
  }
}

class CallRoomCaption {
  const CallRoomCaption({
    required this.segmentId,
    required this.speakerRole,
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
  });

  final String segmentId;
  final String speakerRole;
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

  CallRoomCaption merge(CallRoomCaption next) {
    return CallRoomCaption(
      segmentId: segmentId,
      speakerRole: next.speakerRole,
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
    );
  }

  static String? _nonEmpty(String? value) {
    final trimmed = value?.trim();
    return trimmed == null || trimmed.isEmpty ? null : trimmed;
  }
}

abstract class CallRoomClient {
  Stream<CallRoomSnapshot> get snapshots;

  Future<void> connect(CallRoomToken token);

  Future<void> disconnect();

  Future<void> dispose();
}
