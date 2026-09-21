part of 'session_review.dart';

SessionReview? _serverReview(Map<String, Object?>? json) {
  if (json == null) return null;
  final title = (json['title'] as String? ?? '').trim();
  final summary = (json['summary'] as String? ?? '').trim();
  final decisions = _stringList(json['decisions']);
  final risks = _stringList(json['risks']);
  final openQuestions = _stringList(json['openQuestions']);
  final actionItems = (json['actionItems'] as List<dynamic>? ?? const [])
      .whereType<Map<String, Object?>>()
      .map((item) => SessionActionItem(
            text: item['text'] as String? ?? '',
            completed: item['completed'] as bool? ?? false,
            owner: item['owner'] as String?,
            dueDate: item['dueDate'] as String?,
            evidenceSegmentIds: _stringList(item['evidenceSegmentIds']),
          ))
      .where((item) => item.text.trim().isNotEmpty)
      .toList(growable: false);
  final keyFacts = (json['keyFacts'] as List<dynamic>? ?? const [])
      .whereType<Map<String, Object?>>()
      .map((item) => SessionKeyFact(
            type: item['type'] as String? ?? 'custom',
            text: item['text'] as String? ?? '',
            evidenceSegmentIds: _stringList(item['evidenceSegmentIds']),
          ))
      .where((item) => item.text.trim().isNotEmpty)
      .toList(growable: false);
  final highlights = (json['highlights'] as List<dynamic>? ?? const [])
      .whereType<Map<String, Object?>>()
      .map((item) => SessionHighlight(
            type: item['type'] as String? ?? 'custom',
            text: item['text'] as String? ?? '',
          ))
      .where((item) => item.text.trim().isNotEmpty)
      .toList(growable: false);
  final terms = (json['terms'] as List<dynamic>? ?? const [])
      .whereType<Map<String, Object?>>()
      .map((item) => SessionTermSuggestion(
            sourceText: item['sourceText'] as String? ?? '',
            translatedText: item['translatedText'] as String? ?? '',
          ))
      .where((item) =>
          item.sourceText.trim().isNotEmpty &&
          item.translatedText.trim().isNotEmpty)
      .toList(growable: false);
  if (summary.isEmpty &&
      highlights.isEmpty &&
      terms.isEmpty &&
      decisions.isEmpty &&
      actionItems.isEmpty &&
      keyFacts.isEmpty) {
    return null;
  }
  return SessionReview(
    title: title.isEmpty ? null : title,
    summary: summary,
    decisions: decisions,
    actionItems: actionItems,
    keyFacts: keyFacts,
    risks: risks,
    openQuestions: openQuestions,
    highlights: highlights,
    terms: terms,
    evidenceSegmentIds: _stringList(json['evidenceSegmentIds']),
    generationKind: json['generationKind'] as String?,
    sourceFingerprint: json['sourceFingerprint'] as String?,
  );
}

String? _title(List<SessionSegment> segments) {
  for (final segment in segments) {
    final text = segment.sourceText.trim().isNotEmpty
        ? segment.sourceText.trim()
        : segment.translatedText.trim();
    if (text.isNotEmpty) {
      return text.length <= 40 ? text : text.substring(0, 40);
    }
  }
  return null;
}

List<SessionActionItem> _actionItems(
  List<SessionSegment> segments,
  List<SessionHighlight> highlights,
) =>
    highlights
        .where((item) => item.type == 'todo')
        .map((item) => SessionActionItem(
              text: item.text,
              evidenceSegmentIds: _evidenceForText(segments, item.text),
            ))
        .where((item) => item.evidenceSegmentIds.isNotEmpty)
        .toList(growable: false);

List<SessionKeyFact> _keyFacts(
  List<SessionSegment> segments,
  List<SessionHighlight> highlights,
) =>
    highlights
        .where((item) => item.type != 'todo' && item.type != 'custom')
        .map((item) => SessionKeyFact(
              type: item.type,
              text: item.text,
              evidenceSegmentIds: _evidenceForText(segments, item.text),
            ))
        .where((item) => item.evidenceSegmentIds.isNotEmpty)
        .toList(growable: false);

List<String> _evidenceForText(List<SessionSegment> segments, String text) =>
    segments
        .where((segment) {
          final source = segment.sourceText.trim();
          final translated = segment.translatedText.trim();
          return (source.isNotEmpty && text.contains(source)) ||
              (translated.isNotEmpty && text.contains(translated));
        })
        .map((segment) => segment.id)
        .take(3)
        .toList(growable: false);

List<String> _stringList(Object? value) {
  return (value as List<dynamic>? ?? const [])
      .whereType<String>()
      .map((item) => item.trim())
      .where((item) => item.isNotEmpty)
      .toList(growable: false);
}

String _summary(List<SessionSegment> segments) {
  if (segments.isEmpty) return '';
  final firstLines = segments.take(3).map((segment) {
    final translated = segment.translatedText.trim();
    if (translated.isNotEmpty) return translated;
    return segment.sourceText.trim();
  }).where((text) => text.isNotEmpty);
  return firstLines.join('\n');
}

List<SessionHighlight> _highlights(List<SessionSegment> segments) {
  final highlights = <SessionHighlight>[];
  for (final segment in segments) {
    final text = _combinedText(segment);
    if (text.isEmpty) continue;
    if (_hasTime(text)) {
      highlights.add(SessionHighlight(type: 'time', text: text));
    } else if (_hasMoney(text)) {
      highlights.add(SessionHighlight(type: 'money', text: text));
    } else if (_hasAction(text)) {
      highlights.add(SessionHighlight(type: 'todo', text: text));
    } else if (_hasLocation(text)) {
      highlights.add(SessionHighlight(type: 'location', text: text));
    }
    if (highlights.length >= 8) break;
  }
  return highlights;
}

List<SessionTermSuggestion> _terms(List<SessionSegment> segments) {
  final seen = <String>{};
  final terms = <SessionTermSuggestion>[];
  for (final segment in segments) {
    final source = segment.sourceText.trim();
    final translated = segment.translatedText.trim();
    if (source.isEmpty || translated.isEmpty) continue;
    if (!_looksLikeTerm(source)) continue;
    final key = source.toLowerCase();
    if (!seen.add(key)) continue;
    terms.add(SessionTermSuggestion(
      sourceText: source,
      translatedText: translated,
    ));
    if (terms.length >= 12) break;
  }
  return terms;
}

String _combinedText(SessionSegment segment) {
  final source = segment.sourceText.trim();
  final translated = segment.translatedText.trim();
  if (source.isEmpty) return translated;
  if (translated.isEmpty) return source;
  return '$source\n$translated';
}

bool _hasTime(String text) {
  return RegExp(r"(\d{1,2}[:：]\d{2}|上午|下午|今天|明天|o'clock|tomorrow)",
          caseSensitive: false)
      .hasMatch(text);
}

bool _hasMoney(String text) {
  return RegExp(r'([$¥￥]\s?\d+|\d+\s?(元|美元|yuan|dollars?))',
          caseSensitive: false)
      .hasMatch(text);
}

bool _hasAction(String text) {
  return RegExp(r'(需要|请|安排|确认|发送|整理|need|please|confirm|send|arrange)',
          caseSensitive: false)
      .hasMatch(text);
}

bool _hasLocation(String text) {
  return RegExp(r'(地址|地点|会议室|room|address|location)', caseSensitive: false)
      .hasMatch(text);
}

bool _looksLikeTerm(String source) {
  if (source.length < 2 || source.length > 24) return false;
  if (RegExp(r'[，。！？,.!?]').hasMatch(source)) return false;
  return RegExp(r'[\u4e00-\u9fffA-Za-z]').hasMatch(source);
}
