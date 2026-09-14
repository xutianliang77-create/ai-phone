import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:path_provider/path_provider.dart';

import '../../realtime/domain/entities/subtitle_segment.dart';
import '../../../shared/domain/speaker_attribution.dart';
import 'local_session_export.dart';
import 'session_history_models.dart';

part 'local_session_checkpoint.dart';
part 'local_session_checkpoint_storage.dart';
part 'local_session_checkpoint_history.dart';

class LocalSessionStore {
  LocalSessionStore(
      {File? file,
      DateTime Function()? now,
      Future<void> Function()? checkpointBeforeReplace})
      : _file = file,
        _checkpointBeforeReplace = checkpointBeforeReplace,
        _now = now ?? DateTime.now;

  final File? _file;
  // Failure injection for the flush -> atomic replace boundary in file tests.
  final Future<void> Function()? _checkpointBeforeReplace;
  final DateTime Function() _now;

  Future<bool> putCheckpoint(LocalSessionCheckpoint record) =>
      _putCheckpoint(record);

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
  }) async {
    final file = await _storageFile();
    final sessions = await _loadLegacySessions();
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
          .map(SessionSegment.fromSubtitle)
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
    return formatLocalSessionExport(
      detail,
      format: format,
      serializedDetail: _detailToJson(detail),
    );
  }

  Future<void> deleteSession(String sessionId) async {
    if (await _deleteCheckpointHistory(sessionId)) return;
    final file = await _storageFile();
    final sessions = await _loadLegacySessions();
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
    SessionDetail edit(SessionDetail current) {
      return current.copyWithSegments(current.segments.map((segment) {
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
    }

    final checkpoint = await _editCheckpointHistory(sessionId, edit);
    if (checkpoint != null) return checkpoint;
    final file = await _storageFile();
    final sessions = await _loadLegacySessions();
    final index = sessions.indexWhere((item) => item.sessionId == sessionId);
    if (index < 0) throw LocalSessionNotFoundException(sessionId);
    final current = sessions[index];
    final updated = edit(current);
    sessions[index] = updated;
    await file.writeAsString(jsonEncode({
      'sessions': sessions.map(_detailToJson).toList(),
    }));
    return updated;
  }

  Future<SessionDetail> updateActionItem(
    String sessionId,
    int actionIndex,
    bool completed,
  ) async {
    SessionDetail edit(SessionDetail current) {
      final review = current.reviewJson;
      final actionItems = (review?['actionItems'] as List<dynamic>? ?? const [])
          .map((item) => Map<String, Object?>.from(item as Map))
          .toList();
      if (actionIndex < 0 || actionIndex >= actionItems.length) {
        throw StateError('Action item not found');
      }
      actionItems[actionIndex]['completed'] = completed;
      return current.copyWithReview(<String, Object?>{
        ...review!,
        'actionItems': actionItems,
      });
    }

    final checkpoint = await _editCheckpointHistory(sessionId, edit);
    if (checkpoint != null) return checkpoint;
    final file = await _storageFile();
    final sessions = await _loadLegacySessions();
    final index = sessions.indexWhere((item) => item.sessionId == sessionId);
    if (index < 0) throw LocalSessionNotFoundException(sessionId);
    final current = sessions[index];
    final updated = edit(current);
    sessions[index] = updated;
    await file.writeAsString(jsonEncode({
      'sessions': sessions.map(_detailToJson).toList(),
    }));
    return updated;
  }

  Future<SessionDetail> saveSessionReview(
    String sessionId,
    Map<String, Object?> review,
  ) async {
    SessionDetail edit(SessionDetail current) {
      final previousTerms = current.reviewJson?['confirmedTerms'];
      return current.copyWithReview(<String, Object?>{
        ...review,
        if (previousTerms is List && !review.containsKey('confirmedTerms'))
          'confirmedTerms': previousTerms,
      });
    }

    final checkpoint = await _editCheckpointHistory(sessionId, edit);
    if (checkpoint != null) return checkpoint;
    final file = await _storageFile();
    final sessions = await _loadLegacySessions();
    final index = sessions.indexWhere((item) => item.sessionId == sessionId);
    if (index < 0) throw LocalSessionNotFoundException(sessionId);
    final updated = edit(sessions[index]);
    sessions[index] = updated;
    await file.writeAsString(jsonEncode({
      'sessions': sessions.map(_detailToJson).toList(),
    }));
    return updated;
  }

  Future<TermbaseTerm> confirmTerm({
    required String sessionId,
    required String sourceText,
    required String translatedText,
  }) async {
    final source = sourceText.trim();
    final translated = translatedText.trim();
    if (source.isEmpty || translated.isEmpty) {
      throw ArgumentError('A source and translated term are required');
    }
    final termId = _localTermId(sessionId, source, translated);
    final timestamp = _now().toUtc().toIso8601String();
    late final TermbaseTerm result;
    SessionDetail edit(SessionDetail current) {
      final review = Map<String, Object?>.from(
        current.reviewJson ?? const <String, Object?>{},
      );
      final confirmed = _confirmedTerms(review['confirmedTerms']);
      final index = confirmed.indexWhere((term) => term['id'] == termId);
      final term = <String, Object?>{
        'id': termId,
        'sourceText': source,
        'translatedText': translated,
        'sourceLanguage': _termLanguage(source),
        'targetLanguage': _termLanguage(translated),
        'status': 'active',
        'sessionId': sessionId,
        'createdAt': index < 0 ? timestamp : confirmed[index]['createdAt'],
        'updatedAt': timestamp,
      };
      if (index < 0) {
        confirmed.add(term);
      } else {
        confirmed[index] = term;
      }
      result = _toTermbaseTerm(term);
      return current.copyWithReview(<String, Object?>{
        ...review,
        'confirmedTerms': confirmed,
      });
    }

    final checkpoint = await _editCheckpointHistory(sessionId, edit);
    if (checkpoint != null) return result;
    final file = await _storageFile();
    final sessions = await _loadLegacySessions();
    final index = sessions.indexWhere((item) => item.sessionId == sessionId);
    if (index < 0) throw LocalSessionNotFoundException(sessionId);
    sessions[index] = edit(sessions[index]);
    await file.writeAsString(jsonEncode({
      'sessions': sessions.map(_detailToJson).toList(),
    }));
    return result;
  }

  Future<TermbaseTerm> revokeTerm(String termId) async {
    for (final detail in await _loadSessions()) {
      final terms = _confirmedTerms(detail.reviewJson?['confirmedTerms']);
      final index = terms.indexWhere((term) => term['id'] == termId);
      if (index < 0) continue;
      late final TermbaseTerm result;
      SessionDetail edit(SessionDetail current) {
        final review = Map<String, Object?>.from(
          current.reviewJson ?? const <String, Object?>{},
        );
        final confirmed = _confirmedTerms(review['confirmedTerms']);
        final currentIndex =
            confirmed.indexWhere((term) => term['id'] == termId);
        if (currentIndex < 0) throw StateError('Local term not found');
        final revoked = <String, Object?>{
          ...confirmed[currentIndex],
          'status': 'revoked',
          'updatedAt': _now().toUtc().toIso8601String(),
        };
        confirmed[currentIndex] = revoked;
        result = _toTermbaseTerm(revoked);
        return current.copyWithReview(<String, Object?>{
          ...review,
          'confirmedTerms': confirmed,
        });
      }

      final checkpoint = await _editCheckpointHistory(detail.sessionId, edit);
      if (checkpoint != null) return result;
      final file = await _storageFile();
      final sessions = await _loadLegacySessions();
      final legacyIndex = sessions.indexWhere(
        (item) => item.sessionId == detail.sessionId,
      );
      if (legacyIndex < 0) continue;
      sessions[legacyIndex] = edit(sessions[legacyIndex]);
      await file.writeAsString(jsonEncode({
        'sessions': sessions.map(_detailToJson).toList(),
      }));
      return result;
    }
    throw StateError('Local term not found');
  }

  Future<File> _storageFile() async {
    final file = _file;
    if (file != null) return file;
    final directory = await getApplicationDocumentsDirectory();
    return File('${directory.path}/translation-local-sessions.json');
  }

  Future<List<SessionDetail>> _loadLegacySessions() async {
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
