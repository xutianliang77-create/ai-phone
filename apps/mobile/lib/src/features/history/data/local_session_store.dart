import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import '../../realtime/domain/entities/subtitle_segment.dart';
import '../../../shared/domain/speaker_attribution.dart';
import 'session_history_models.dart';

class LocalSessionStore {
  LocalSessionStore({File? file, DateTime Function()? now})
      : _file = file,
        _now = now ?? DateTime.now;

  final File? _file;
  final DateTime Function() _now;

  Future<List<SessionListItem>> listSessions({String query = ''}) async {
    final sessions = await _loadSessions();
    final normalizedQuery = query.trim().toLowerCase();
    return sessions
        .where((session) {
          if (normalizedQuery.isEmpty) return true;
          return session.segments.any((segment) {
            return segment.sourceText.toLowerCase().contains(normalizedQuery) ||
                segment.translatedText.toLowerCase().contains(normalizedQuery);
          });
        })
        .map(_toListItem)
        .toList();
  }

  Future<SessionDetail> getSession(String sessionId) async {
    final sessions = await _loadSessions();
    return sessions.firstWhere(
      (session) => session.sessionId == sessionId,
      orElse: () => throw LocalSessionNotFoundException(sessionId),
    );
  }

  Future<void> saveEndedSession({
    required String sessionId,
    required DateTime createdAt,
    required List<SubtitleSegment> segments,
  }) async {
    final file = await _storageFile();
    final sessions = await _loadSessions();
    final endedAt = _now();
    final saved = SessionDetail(
      sessionId: sessionId,
      mode: 'conversation',
      status: 'ended',
      consumedSeconds: endedAt.difference(createdAt).inSeconds.clamp(0, 86400),
      createdAt: createdAt,
      endedAt: endedAt,
      segmentCount: segments.length,
      segments: segments
          .where((segment) =>
              segment.sourceText.trim().isNotEmpty ||
              segment.translatedText.trim().isNotEmpty)
          .map((segment) => SessionSegment(
                id: segment.id,
                turnId: segment.turnId,
                revision: segment.revision,
                sourceText: segment.sourceText,
                translatedText: segment.translatedText,
                sourceLanguage: segment.sourceLanguage,
                targetLanguage: segment.targetLanguage,
                confidence: segment.confidence,
                stage: segment.stage,
                provider: segment.provider,
                model: segment.model,
                latencyMs: segment.latencyMs,
                languageProfile: segment.languageProfile,
                speaker: segment.speaker,
                timing: segment.timing,
                vadContext: segment.vadContext,
              ))
          .toList(),
    );
    final next = <SessionDetail>[
      saved,
      ...sessions.where((session) => session.sessionId != sessionId),
    ];
    await file.parent.create(recursive: true);
    await file.writeAsString(jsonEncode({
      'sessions': next.map(_detailToJson).toList(),
    }));
  }

  Future<SessionExport> exportSession(
    String sessionId, {
    String format = 'markdown',
  }) async {
    final detail = await getSession(sessionId);
    final content = _markdown(detail);
    return SessionExport(
      sessionId: sessionId,
      filename: 'translation-session-$sessionId.md',
      mimeType: 'text/markdown',
      content: content,
    );
  }

  Future<void> deleteSession(String sessionId) async {
    final file = await _storageFile();
    final sessions = await _loadSessions();
    await file.writeAsString(jsonEncode({
      'sessions': sessions
          .where((session) => session.sessionId != sessionId)
          .map(_detailToJson)
          .toList(),
    }));
  }

  Future<SessionDetail> renameSpeaker(
    String sessionId,
    String speakerId,
    String displayName,
  ) async {
    final file = await _storageFile();
    final sessions = await _loadSessions();
    final index = sessions.indexWhere((item) => item.sessionId == sessionId);
    if (index < 0) throw LocalSessionNotFoundException(sessionId);
    final current = sessions[index];
    final updated = current.copyWithSegments(current.segments.map((segment) {
      final speaker = segment.speaker;
      if (speaker?.speakerId != speakerId) return segment;
      return segment.copyWithSpeaker(SpeakerAttribution(
        speakerId: speaker!.speakerId,
        role: speaker.role,
        source: speaker.source,
        displayName: displayName,
        confidence: speaker.confidence,
      ));
    }).toList());
    sessions[index] = updated;
    await file.writeAsString(jsonEncode({
      'sessions': sessions.map(_detailToJson).toList(),
    }));
    return updated;
  }

  Future<File> _storageFile() async {
    final file = _file;
    if (file != null) return file;
    final directory = await getApplicationDocumentsDirectory();
    return File('${directory.path}/translation-local-sessions.json');
  }

  Future<List<SessionDetail>> _loadSessions() async {
    final file = await _storageFile();
    if (!await file.exists()) return <SessionDetail>[];
    final decoded =
        jsonDecode(await file.readAsString()) as Map<String, Object?>;
    return (decoded['sessions'] as List<dynamic>? ?? const <dynamic>[])
        .cast<Map<String, Object?>>()
        .map(SessionDetail.fromJson)
        .toList();
  }
}

SessionListItem _toListItem(SessionDetail detail) {
  return SessionListItem(
    sessionId: detail.sessionId,
    mode: detail.mode,
    status: detail.status,
    consumedSeconds: detail.consumedSeconds,
    createdAt: detail.createdAt,
    endedAt: detail.endedAt,
    segmentCount: detail.segmentCount,
  );
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
    'segments': detail.segments.map((segment) {
      return <String, Object?>{
        'id': segment.id,
        if (segment.turnId != null) 'turnId': segment.turnId,
        if (segment.revision != null) 'revision': segment.revision,
        'sourceText': segment.sourceText,
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
        if (segment.languageProfile != null)
          ...segment.languageProfile!.toJson(),
        if (segment.speaker != null) 'speaker': segment.speaker!.toJson(),
        if (segment.timing != null) 'timing': segment.timing!.toJson(),
        if (segment.vadContext != null) 'vadContext': segment.vadContext,
      };
    }).toList(),
  };
}

String _markdown(SessionDetail detail) {
  final buffer = StringBuffer()
    ..writeln('# Translation Session')
    ..writeln()
    ..writeln('- Session: ${detail.sessionId}')
    ..writeln('- Created: ${detail.createdAt.toIso8601String()}')
    ..writeln('- Status: ${detail.status}')
    ..writeln();
  for (final segment in detail.segments) {
    if (segment.speaker != null) {
      buffer.writeln(
        'Speaker: ${segment.speaker!.label(isChinese: true)}',
      );
    }
    buffer
      ..writeln('## ${segment.id}')
      ..writeln()
      ..writeln(segment.sourceText)
      ..writeln()
      ..writeln(segment.translatedText)
      ..writeln();
    _writeSegmentDiagnostics(buffer, segment);
  }
  return buffer.toString();
}

void _writeSegmentDiagnostics(StringBuffer buffer, SessionSegment segment) {
  final diagnostics = <String>[
    if (segment.sourceLanguage != null)
      'Source language: ${segment.sourceLanguage}',
    if (segment.targetLanguage != null)
      'Target language: ${segment.targetLanguage}',
    if (segment.confidence != null) 'Confidence: ${segment.confidence}',
    if (segment.stage != null) 'Stage: ${segment.stage}',
    if (segment.provider != null) 'Provider: ${segment.provider}',
    if (segment.model != null) 'Model: ${segment.model}',
    if (segment.latencyMs != null) 'Latency: ${segment.latencyMs}ms',
  ];
  if (diagnostics.isEmpty) return;
  buffer
    ..writeln('Diagnostics')
    ..writeln();
  for (final item in diagnostics) {
    buffer.writeln('- $item');
  }
  buffer.writeln();
}

class LocalSessionNotFoundException implements Exception {
  const LocalSessionNotFoundException(this.sessionId);

  final String sessionId;

  @override
  String toString() => 'Local session not found: $sessionId';
}
