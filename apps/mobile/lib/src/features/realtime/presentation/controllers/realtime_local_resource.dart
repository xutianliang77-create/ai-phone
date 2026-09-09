import '../../../../platform/speech/system_speech_voice.dart';

enum LocalResourceKind { asr, translation, speech }

enum LocalResourcePhase {
  unchecked,
  checking,
  missing,
  ready,
  unsupported,
  preparing,
  failed,
  cancelled
}

/// Current resource observation only, never a persisted quality qualification.
class RealtimeLocalResource {
  const RealtimeLocalResource(
      {required this.kind,
      required this.sourceLanguage,
      this.targetLanguage,
      this.phase = LocalResourcePhase.unchecked,
      this.reason = '',
      this.voice,
      this.canPrepare = false});
  final LocalResourceKind kind;
  final String sourceLanguage;
  final String? targetLanguage;
  final LocalResourcePhase phase;
  final String reason;
  final bool canPrepare;
  final SystemSpeechVoice? voice;
  String get id => '${kind.name}|$sourceLanguage|${targetLanguage ?? ""}';
  RealtimeLocalResource observed(LocalResourcePhase phase, String reason,
          {bool canPrepare = false, SystemSpeechVoice? voice}) =>
      RealtimeLocalResource(
          kind: kind,
          sourceLanguage: sourceLanguage,
          targetLanguage: targetLanguage,
          phase: phase,
          reason: reason,
          voice: voice,
          canPrepare: canPrepare);
}
