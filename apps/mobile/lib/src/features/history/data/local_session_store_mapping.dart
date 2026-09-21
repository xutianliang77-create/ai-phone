part of 'local_session_store.dart';

SessionListItem _toListItem(SessionDetail detail) {
  return SessionListItem(
    sessionId: detail.sessionId,
    mode: detail.mode,
    status: detail.status,
    consumedSeconds: detail.consumedSeconds,
    createdAt: detail.createdAt,
    endedAt: detail.endedAt,
    segmentCount: detail.segmentCount,
    kind: _localSessionKind(detail),
    title: detail.title ?? _localSessionTitle(detail),
    sourceLanguage: detail.sourceLanguage ?? _firstSourceLanguage(detail),
    targetLanguage: detail.targetLanguage ?? _firstTargetLanguage(detail),
    speakerCount: _localSpeakerCount(detail),
  );
}

String _localSessionKind(SessionDetail detail) {
  if (detail.segments.any((segment) => segment.provider == 'scan')) {
    return 'scan';
  }
  if (detail.mode == 'call_link' ||
      detail.segments.any((segment) => segment.provider == 'type_to_speak')) {
    return 'call';
  }
  return 'realtime';
}

String? _localSessionTitle(SessionDetail detail) {
  for (final segment in detail.segments) {
    final title = segment.sourceText.trim().isNotEmpty
        ? segment.sourceText.trim()
        : segment.translatedText.trim();
    if (title.isEmpty) continue;
    return title.length <= 36 ? title : '${title.substring(0, 35)}…';
  }
  return null;
}

String? _firstSourceLanguage(SessionDetail detail) {
  for (final segment in detail.segments) {
    if (segment.sourceLanguage != null) return segment.sourceLanguage;
  }
  return null;
}

String? _firstTargetLanguage(SessionDetail detail) {
  for (final segment in detail.segments) {
    if (segment.targetLanguage != null) return segment.targetLanguage;
  }
  return null;
}

int _localSpeakerCount(SessionDetail detail) {
  return detail.segments
      .map((segment) => segment.speaker?.speakerId.trim())
      .whereType<String>()
      .where((speakerId) =>
          speakerId.isNotEmpty && speakerId.toLowerCase() != 'unknown')
      .toSet()
      .length;
}

Map<String, Object?> _detailToJson(SessionDetail detail) {
  return <String, Object?>{
    'sessionId': detail.sessionId,
    'mode': detail.mode,
    'status': detail.status,
    'consumedSeconds': detail.consumedSeconds,
    'createdAt': detail.createdAt.toIso8601String(),
    'endedAt': detail.endedAt?.toIso8601String(),
    'segmentCount': detail.segments.length,
    'kind': detail.kind,
    if (detail.title != null) 'title': detail.title,
    if (detail.sourceLanguage != null) 'sourceLanguage': detail.sourceLanguage,
    if (detail.targetLanguage != null) 'targetLanguage': detail.targetLanguage,
    'speakerCount': detail.speakerCount,
    if (detail.reviewJson != null) 'review': detail.reviewJson,
    'segments': detail.segments.map((segment) {
      return <String, Object?>{
        'id': segment.id,
        if (segment.turnId != null) 'turnId': segment.turnId,
        if (segment.revision != null) 'revision': segment.revision,
        'sourceText': segment.sourceText,
        'translatedText': segment.translatedText,
        if (segment.rawText != null) 'rawText': segment.rawText,
        if (segment.optimizedText != null)
          'optimizedText': segment.optimizedText,
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
        if (segment.languageProfile != null)
          ...segment.languageProfile!.toJson(),
        if (segment.speaker != null) 'speaker': segment.speaker!.toJson(),
        if (segment.timing != null) 'timing': segment.timing!.toJson(),
        if (segment.vadContext != null) 'vadContext': segment.vadContext,
      };
    }).toList(),
  };
}

class LocalSessionNotFoundException implements Exception {
  const LocalSessionNotFoundException(this.sessionId);

  final String sessionId;

  @override
  String toString() => 'Local session not found: $sessionId';
}

List<Map<String, Object?>> _confirmedTerms(Object? value) =>
    (value as List<dynamic>? ?? const <dynamic>[])
        .whereType<Map>()
        .map((term) => Map<String, Object?>.from(term))
        .toList(growable: true);

TermbaseTerm _toTermbaseTerm(Map<String, Object?> value) => TermbaseTerm(
      id: value['id']! as String,
      sourceText: value['sourceText']! as String,
      translatedText: value['translatedText']! as String,
      sourceLanguage: value['sourceLanguage']! as String,
      targetLanguage: value['targetLanguage']! as String,
      status: value['status']! as String,
    );

String _localTermId(String sessionId, String source, String translated) {
  final digest =
      sha256.convert(utf8.encode('$sessionId\n$source\n$translated'));
  return 'local_term_${digest.toString().substring(0, 32)}';
}

String _termLanguage(String value) {
  return RegExp(r'[\u4e00-\u9fff]').hasMatch(value) ? 'zh' : 'en';
}
