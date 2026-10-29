import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';
import 'package:crypto/crypto.dart';

import '../../realtime/domain/entities/subtitle_segment.dart';
import '../../../shared/domain/speaker_attribution.dart';
import 'local_session_export.dart';
import 'session_history_models.dart';
import 'session_review.dart';

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
            return <String>[
              segment.sourceText,
              segment.rawText ?? '',
              segment.optimizedText ?? '',
              segment.translatedText,
            ].any((text) => text.toLowerCase().contains(normalizedQuery));
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
  }) => _saveSnapshot(sessionId:sessionId,createdAt:createdAt,segments:segments,finished:true);

  /// A durable, exportable snapshot. It is replaced by the final record on
  /// normal stop and remains available if the process is interrupted.
  Future<void> saveRecoverableSession({
    required String sessionId,
    required DateTime createdAt,
    required List<SubtitleSegment> segments,
  }) => _saveSnapshot(sessionId:sessionId,createdAt:createdAt,segments:segments,finished:false);

  Future<void> _saveSnapshot({
    required String sessionId,
    required DateTime createdAt,
    required List<SubtitleSegment> segments,
    required bool finished,
  }) async {
    return _writeSerial(() async {
    final file = await _storageFile();
    final sessions = await _loadSessions();
    // A delayed checkpoint must never replace a completed record.
    if (!finished && sessions.any((s) => s.sessionId == sessionId && s.status == 'ended')) return;
    final matches = sessions.where((s) => s.sessionId == sessionId);
    final previous = matches.isEmpty ? null : matches.first;
    final previousSpeakers = <String, SpeakerAttribution>{
      if (previous != null)
        for (final s in previous.segments)
          if (s.speaker != null) s.id: s.speaker!,
    };
    final endedAt = _now();
    final saved = SessionDetail(
      sessionId: sessionId,
      mode: 'conversation',
      status: finished ? 'ended' : 'recoverable',
      consumedSeconds: endedAt.difference(createdAt).inSeconds.clamp(0, 86400),
      createdAt: createdAt,
      endedAt: finished ? endedAt : null,
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
                rawText: segment.rawText,
                optimizedText: segment.optimizedText,
                sourceLanguage: segment.sourceLanguage,
                targetLanguage: segment.targetLanguage,
                confidence: segment.confidence,
                stage: segment.stage,
                provider: segment.provider,
                model: segment.model,
                latencyMs: segment.latencyMs,
                languageProfile: segment.languageProfile,
                speaker: previousSpeakers[segment.id]?.speakerId == segment.speaker?.speakerId
                    ? previousSpeakers[segment.id]
                    : segment.speaker,
                timing: segment.timing,
                vadContext: segment.vadContext,
              ))
          .toList(),
      reviewJson: previous?.reviewJson,
      title: previous?.title,
    );
    final next = <SessionDetail>[
      saved,
      ...sessions.where((session) => session.sessionId != sessionId),
    ];
    await file.parent.create(recursive: true);
    await _persist(file, {
      'sessions': next.map(_detailToJson).toList(),
    });
    });
  }

  Future<SessionDetail> generateLocalReview(String sessionId) => _writeSerial(() async {
    final file = await _storageFile();
    final sessions = await _loadSessions();
    final index = sessions.indexWhere((s) => s.sessionId == sessionId);
    if (index < 0) throw LocalSessionNotFoundException(sessionId);
    final current = sessions[index];
    final review = buildExtractiveSessionReview(current);
    final updated = current.copyWithReview({
      ...?current.reviewJson,
      'source': 'local_extractive',
      'title': '本机摘录',
      'summary': review.summary,
      'highlights': [for (final h in review.highlights) {'type': h.type, 'text': h.text}],
      'terms': [for (final t in review.terms) {'sourceText': t.sourceText, 'translatedText': t.translatedText}],
      // Preserve manually completed actions when regenerating an existing review.
      if (current.reviewJson?['actionItems'] is List) 'actionItems': current.reviewJson!['actionItems'],
    });
    sessions[index] = updated;
    await _persist(file, {'sessions': sessions.map(_detailToJson).toList()});
    return updated;
  });

  Future<List<TermbaseTerm>> listLocalTerms() async {
    final file = File('${(await _storageFile()).path}.terms.json');
    if (!await file.exists()) return [];
    final root = jsonDecode(await file.readAsString()) as Map<String, dynamic>;
    return (root['terms'] as List<dynamic>? ?? const [])
        .cast<Map<String, Object?>>()
        .map(TermbaseTerm.fromJson).toList();
  }

  Future<TermbaseTerm> confirmLocalTerm({required String sessionId, required String sourceText,
    required String translatedText, required String sourceLanguage, required String targetLanguage}) =>
      _writeSerial(() async {
        // A term may only be attached to an existing, account-scoped session.
        await getSession(sessionId);
        final source = sourceText.trim(), translated = translatedText.trim();
        if (source.isEmpty || translated.isEmpty) throw ArgumentError('term_empty');
        final id = 'local_${sha256.convert(utf8.encode('${source.toLowerCase()}\n${translated.toLowerCase()}'))}';
        final term = TermbaseTerm(id: id, sourceText: source, translatedText: translated,
          sourceLanguage: sourceLanguage, targetLanguage: targetLanguage, status: 'active');
        final all = await listLocalTerms();
        await _persist(File('${(await _storageFile()).path}.terms.json'), {
          'terms': [_termToJson(term), ...all.where((t) => t.id != id).map(_termToJson)],
        });
        return term;
      });

  Future<TermbaseTerm> revokeLocalTerm(String id) => _writeSerial(() async {
    final all = await listLocalTerms();
    final index = all.indexWhere((t) => t.id == id);
    if (index < 0) throw StateError('term_not_found');
    final old = all[index];
    final term = TermbaseTerm(id: old.id, sourceText: old.sourceText, translatedText: old.translatedText,
      sourceLanguage: old.sourceLanguage, targetLanguage: old.targetLanguage, status: 'revoked');
    all[index] = term;
    await _persist(File('${(await _storageFile()).path}.terms.json'), {'terms': all.map(_termToJson).toList()});
    return term;
  });

  Map<String, Object?> _termToJson(TermbaseTerm t) => {'id': t.id, 'sourceText': t.sourceText,
    'translatedText': t.translatedText, 'sourceLanguage': t.sourceLanguage,
    'targetLanguage': t.targetLanguage, 'status': t.status};

  Future<SessionExport> exportSession(
    String sessionId, {
    String format = 'markdown',
  }) async {
    final detail = await getSession(sessionId);
    return formatLocalSessionExport(
      detail,
      format: format,
      serializedDetail: _detailToJson(detail),
    );
  }

  Future<void> deleteSession(String sessionId) async {
    return _writeSerial(() async {
    final file = await _storageFile();
    final sessions = await _loadSessions();
    await _persist(file, {
      'sessions': sessions
          .where((session) => session.sessionId != sessionId)
          .map(_detailToJson)
          .toList(),
    });
    });
  }

  Future<SessionDetail> renameSpeaker(
    String sessionId,
    String speakerId,
    String displayName,
  ) async {
    return _writeSerial(() async {
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
    await _persist(file, {
      'sessions': sessions.map(_detailToJson).toList(),
    });
    return updated;
    });
  }

  Future<SessionDetail> updateActionItem(
    String sessionId,
    int actionIndex,
    bool completed,
  ) async {
    return _writeSerial(() async {
    final file = await _storageFile();
    final sessions = await _loadSessions();
    final index = sessions.indexWhere((item) => item.sessionId == sessionId);
    if (index < 0) throw LocalSessionNotFoundException(sessionId);
    final current = sessions[index];
    final review = current.reviewJson;
    final actionItems = (review?['actionItems'] as List<dynamic>? ?? const [])
        .map((item) => Map<String, Object?>.from(item as Map))
        .toList();
    if (actionIndex < 0 || actionIndex >= actionItems.length) {
      throw StateError('Action item not found');
    }
    actionItems[actionIndex]['completed'] = completed;
    final updated = current.copyWithReview(<String, Object?>{
      ...review!,
      'actionItems': actionItems,
    });
    sessions[index] = updated;
    await _persist(file, {
      'sessions': sessions.map(_detailToJson).toList(),
    });
    return updated;
    });
  }

  static final _writeQueues = <String, Future<void>>{};
  Future<T> _writeSerial<T>(Future<T> Function() action) async {
    final file = await _storageFile();
    final previous = _writeQueues[file.path] ?? Future<void>.value();
    final done = Completer<void>(); _writeQueues[file.path] = done.future;
    await previous.catchError((Object _) {});
    try { return await action(); }
    finally { done.complete(); if (identical(_writeQueues[file.path], done.future)) _writeQueues.remove(file.path); }
  }
  Future<void> _persist(File file, Map<String, Object?> value) async {
    await file.parent.create(recursive: true);
    final temporary = File('${file.path}.${DateTime.now().microsecondsSinceEpoch}.tmp');
    try { await temporary.writeAsString(jsonEncode(value), flush: true); await temporary.rename(file.path); }
    finally { if (await temporary.exists()) await temporary.delete(); }
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
