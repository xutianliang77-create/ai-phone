part of 'realtime_repository.dart';

class RealtimeFinalizationException implements Exception {
  const RealtimeFinalizationException(this.message);

  final String message;

  @override
  String toString() => message;
}

bool shouldAutoReverseRealtimeSession(AppConfig config) {
  // Never infer automatic reversal from a convenient default language pair.
  // Public automatic routing remains explicitly unqualified, and local mode
  // already rejects the saved automatic preference before startup.
  return config.autoReverseTargetLanguage;
}

Map<String, Object?> _segmentToJson(SubtitleSegment segment) {
  return {
    'id': segment.id,
    'sourceText': segment.sourceText,
    if (segment.rawText != null) 'rawText': segment.rawText,
    if (segment.optimizedText != null) 'optimizedText': segment.optimizedText,
    'translatedText': segment.translatedText,
    if (segment.sourceLanguage != null)
      'sourceLanguage': segment.sourceLanguage,
    if (segment.targetLanguage != null)
      'targetLanguage': segment.targetLanguage,
    if (segment.confidence != null) 'confidence': segment.confidence,
    if (segment.stage != null) 'stage': segment.stage,
    if (segment.provider != null) 'provider': segment.provider,
    if (segment.model != null) 'model': segment.model,
    if (segment.latencyMs != null) 'latencyMs': segment.latencyMs,
    if (segment.refinement != null) 'refinement': segment.refinement,
    if (segment.languageProfile != null) ...segment.languageProfile!.toJson(),
    if (segment.speaker != null) 'speaker': segment.speaker!.toJson(),
    if (segment.timing != null) 'timing': segment.timing!.toJson(),
    if (segment.vadContext != null) 'vadContext': segment.vadContext,
  };
}

List<Map<String, Object?>> _snapshotSegments(
  List<SubtitleSegment> segments,
) {
  return segments
      .where((segment) =>
          segment.sourceText.trim().isNotEmpty ||
          segment.translatedText.trim().isNotEmpty)
      .map(_segmentToJson)
      .toList(growable: false);
}

RealtimeFinalizationTask? _taskForSession(
  List<RealtimeFinalizationTask> tasks,
  String sessionId,
) {
  for (final task in tasks) {
    if (task.sessionId == sessionId) return task;
  }
  return null;
}
