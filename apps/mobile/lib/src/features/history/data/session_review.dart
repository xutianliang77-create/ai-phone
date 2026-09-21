import 'dart:convert';

import 'package:crypto/crypto.dart';

import 'session_history_models.dart';

part 'session_review_helpers.dart';

class SessionReview {
  const SessionReview({
    required this.summary,
    this.title,
    this.decisions = const <String>[],
    this.actionItems = const <SessionActionItem>[],
    this.keyFacts = const <SessionKeyFact>[],
    this.risks = const <String>[],
    this.openQuestions = const <String>[],
    required this.highlights,
    required this.terms,
    this.evidenceSegmentIds = const <String>[],
    this.generationKind,
    this.sourceFingerprint,
  });

  final String summary;
  final String? title;
  final List<String> decisions;
  final List<SessionActionItem> actionItems;
  final List<SessionKeyFact> keyFacts;
  final List<String> risks;
  final List<String> openQuestions;
  final List<SessionHighlight> highlights;
  final List<SessionTermSuggestion> terms;
  final List<String> evidenceSegmentIds;
  final String? generationKind;
  final String? sourceFingerprint;
}

class SessionActionItem {
  const SessionActionItem({
    required this.text,
    this.completed = false,
    this.owner,
    this.dueDate,
    this.evidenceSegmentIds = const <String>[],
  });

  final String text;
  final bool completed;
  final String? owner;
  final String? dueDate;
  final List<String> evidenceSegmentIds;
}

class SessionKeyFact {
  const SessionKeyFact({
    required this.type,
    required this.text,
    this.evidenceSegmentIds = const <String>[],
  });

  final String type;
  final String text;
  final List<String> evidenceSegmentIds;
}

class SessionHighlight {
  const SessionHighlight({
    required this.type,
    required this.text,
  });

  final String type;
  final String text;
}

class SessionTermSuggestion {
  const SessionTermSuggestion({
    required this.sourceText,
    required this.translatedText,
  });

  final String sourceText;
  final String translatedText;
}

SessionReview buildSessionReview(SessionDetail detail) {
  final serverReview = _serverReview(detail.reviewJson);
  if (serverReview != null) return serverReview;
  final textPairs = detail.segments
      .where((segment) =>
          segment.sourceText.trim().isNotEmpty ||
          segment.translatedText.trim().isNotEmpty)
      .toList(growable: false);
  return _deviceRuleReview(detail, textPairs);
}

Map<String, Object?> buildDeviceRuleReviewJson(
  SessionDetail detail,
  DateTime generatedAt,
) {
  final review = _deviceRuleReview(detail, _textPairs(detail));
  return <String, Object?>{
    'provider': 'local',
    'promptVersion': 'session_review_device_rules_v1',
    'generatedAt': generatedAt.toUtc().toIso8601String(),
    'generationKind': 'device_rules',
    'sourceFingerprint': deviceRuleReviewSourceFingerprint(detail),
    if (review.title != null) 'title': review.title,
    'summary': review.summary,
    'decisions': review.decisions,
    'actionItems': review.actionItems
        .map((item) => <String, Object?>{
              'text': item.text,
              'completed': item.completed,
              if (item.owner != null) 'owner': item.owner,
              if (item.dueDate != null) 'dueDate': item.dueDate,
              'evidenceSegmentIds': item.evidenceSegmentIds,
            })
        .toList(growable: false),
    'keyFacts': review.keyFacts
        .map((item) => <String, Object?>{
              'type': item.type,
              'text': item.text,
              'evidenceSegmentIds': item.evidenceSegmentIds,
            })
        .toList(growable: false),
    'risks': review.risks,
    'openQuestions': review.openQuestions,
    'highlights': review.highlights
        .map((item) => <String, Object?>{'type': item.type, 'text': item.text})
        .toList(growable: false),
    'terms': review.terms
        .map((item) => <String, Object?>{
              'sourceText': item.sourceText,
              'translatedText': item.translatedText,
            })
        .toList(growable: false),
    'evidenceSegmentIds': review.evidenceSegmentIds,
  };
}

bool isCurrentDeviceRuleReview(SessionDetail detail) {
  final review = detail.reviewJson;
  return review?['generationKind'] == 'device_rules' &&
      review?['sourceFingerprint'] == deviceRuleReviewSourceFingerprint(detail);
}

Map<String, String> confirmedTermIdsForSession(SessionDetail detail) {
  final values = detail.reviewJson?['confirmedTerms'] as List<dynamic>? ??
      const <dynamic>[];
  final result = <String, String>{};
  for (final value in values) {
    if (value is! Map) continue;
    final id = value['id'] as String?;
    final source = value['sourceText'] as String?;
    final translated = value['translatedText'] as String?;
    if (id == null ||
        source == null ||
        translated == null ||
        value['status'] != 'active') {
      continue;
    }
    result[sessionReviewTermKey(source, translated)] = id;
  }
  return result;
}

String sessionReviewTermKey(String sourceText, String translatedText) {
  return '${sourceText.trim().toLowerCase()}\n'
      '${translatedText.trim().toLowerCase()}';
}

String deviceRuleReviewSourceFingerprint(SessionDetail detail) {
  final source = _textPairs(detail)
      .map((segment) => <String, Object?>{
            'id': segment.id,
            'turnId': segment.turnId,
            'revision': segment.revision,
            'rawText': segment.rawText,
            'optimizedText': segment.optimizedText,
            'sourceText': segment.sourceText,
            'translatedText': segment.translatedText,
            'sourceLanguage': segment.sourceLanguage,
            'targetLanguage': segment.targetLanguage,
            'speakerId': segment.speaker?.speakerId,
            'startMs': segment.timing?.startMs,
            'endMs': segment.timing?.endMs,
          })
      .toList(growable: false);
  return sha256.convert(utf8.encode(jsonEncode(source))).toString();
}

SessionReview _deviceRuleReview(
  SessionDetail detail,
  List<SessionSegment> textPairs,
) {
  final highlights = _highlights(textPairs);
  return SessionReview(
    title: _title(textPairs),
    summary: _summary(textPairs),
    actionItems: _actionItems(textPairs, highlights),
    keyFacts: _keyFacts(textPairs, highlights),
    highlights: highlights,
    terms: _terms(textPairs),
    evidenceSegmentIds: textPairs.take(5).map((segment) => segment.id).toList(),
    generationKind: 'device_rules',
    sourceFingerprint: deviceRuleReviewSourceFingerprint(detail),
  );
}

List<SessionSegment> _textPairs(SessionDetail detail) => detail.segments
    .where((segment) =>
        segment.sourceText.trim().isNotEmpty ||
        segment.translatedText.trim().isNotEmpty)
    .toList(growable: false);
