import 'dart:convert';

import 'session_history_models.dart';

SessionExport formatLocalSessionExport(
  SessionDetail detail, {
  required String format,
  required Map<String, Object?> serializedDetail,
}) {
  final (extension, mimeType, content) = switch (format) {
    'markdown' => ('md', 'text/markdown', _markdown(detail)),
    'txt' => ('txt', 'text/plain', _plainText(detail)),
    'json' => (
        'json',
        'application/json',
        const JsonEncoder.withIndent('  ').convert(serializedDetail),
      ),
    'csv' => ('csv', 'text/csv', _csv(detail)),
    _ => throw ArgumentError.value(format, 'format', 'Unsupported format'),
  };
  return SessionExport(
    sessionId: detail.sessionId,
    filename: 'translation-session-${detail.sessionId}.$extension',
    mimeType: mimeType,
    content: content,
  );
}

String _plainText(SessionDetail detail) {
  final segments = detail.segments.map((segment) {
    return <String>[
      if (segment.speaker != null)
        'Speaker: ${segment.speaker!.label(isChinese: true)}',
      'Raw: ${_rawText(segment)}',
      'Optimized: ${_optimizedText(segment)}',
      'Translation: ${segment.translatedText}',
    ].join('\n');
  }).join('\n\n');
  final review = _plainTextReview(detail.reviewJson);
  return review.isEmpty ? segments : '$review\n\n$segments';
}

String _markdown(SessionDetail detail) {
  final buffer = StringBuffer()
    ..writeln('# Translation Session')
    ..writeln()
    ..writeln('- Session: ${detail.sessionId}')
    ..writeln('- Created: ${detail.createdAt.toIso8601String()}')
    ..writeln('- Status: ${detail.status}')
    ..writeln();
  _writeReviewMarkdown(buffer, detail.reviewJson);
  for (final segment in detail.segments) {
    buffer
      ..writeln('## ${segment.id}')
      ..writeln();
    if (segment.speaker != null) {
      buffer
        ..writeln('Speaker: ${segment.speaker!.label(isChinese: true)}')
        ..writeln();
    }
    buffer
      ..writeln('Raw')
      ..writeln()
      ..writeln(_rawText(segment))
      ..writeln()
      ..writeln('Optimized')
      ..writeln()
      ..writeln(_optimizedText(segment))
      ..writeln()
      ..writeln('Translation')
      ..writeln()
      ..writeln(segment.translatedText)
      ..writeln();
    _writeSegmentDiagnostics(buffer, segment);
  }
  return buffer.toString();
}

String _plainTextReview(Map<String, Object?>? review) {
  if (review == null) return '';
  final lines = <String>[];
  final title = _reviewText(review['title']);
  if (title.isNotEmpty) lines.add('Title: $title');
  final summary = _reviewText(review['summary']);
  if (summary.isNotEmpty) lines.add('Summary:\n$summary');
  _appendReviewList(lines, 'Actions', review['actionItems']);
  _appendReviewList(lines, 'Terms', review['terms'], term: true);
  _appendReviewList(
    lines,
    'Confirmed terms',
    review['confirmedTerms'],
    term: true,
    activeOnly: true,
  );
  return lines.join('\n\n');
}

void _writeReviewMarkdown(StringBuffer buffer, Map<String, Object?>? review) {
  if (review == null) return;
  final title = _reviewText(review['title']);
  if (title.isNotEmpty) {
    buffer
      ..writeln('## Title')
      ..writeln()
      ..writeln(title)
      ..writeln();
  }
  final summary = _reviewText(review['summary']);
  if (summary.isNotEmpty) {
    buffer
      ..writeln('## Summary')
      ..writeln()
      ..writeln(summary)
      ..writeln();
  }
  _writeReviewMarkdownList(buffer, 'Actions', review['actionItems']);
  _writeReviewMarkdownList(buffer, 'Terms', review['terms'], term: true);
  _writeReviewMarkdownList(
    buffer,
    'Confirmed Terms',
    review['confirmedTerms'],
    term: true,
    activeOnly: true,
  );
}

void _appendReviewList(
  List<String> lines,
  String title,
  Object? value, {
  bool term = false,
  bool activeOnly = false,
}) {
  final entries = _reviewEntries(value, term: term, activeOnly: activeOnly);
  if (entries.isEmpty) return;
  lines.add('$title:\n${entries.map((entry) => '- $entry').join('\n')}');
}

void _writeReviewMarkdownList(
  StringBuffer buffer,
  String title,
  Object? value, {
  bool term = false,
  bool activeOnly = false,
}) {
  final entries = _reviewEntries(value, term: term, activeOnly: activeOnly);
  if (entries.isEmpty) return;
  buffer
    ..writeln('## $title')
    ..writeln();
  for (final entry in entries) {
    buffer.writeln('- $entry');
  }
  buffer.writeln();
}

List<String> _reviewEntries(
  Object? value, {
  required bool term,
  bool activeOnly = false,
}) {
  final entries = <String>[];
  for (final item in value as List<dynamic>? ?? const <dynamic>[]) {
    if (item is! Map) continue;
    if (activeOnly && item['status'] != 'active') continue;
    final text = term
        ? '${_reviewText(item['sourceText'])}: ${_reviewText(item['translatedText'])}'
        : _reviewText(item['text']);
    if (text.trim().isNotEmpty && !text.endsWith(': ')) entries.add(text);
  }
  return entries;
}

String _reviewText(Object? value) => value is String ? value.trim() : '';

String _csv(SessionDetail detail) {
  final rows = <List<String>>[
    <String>[
      'id',
      'sourceText',
      'rawText',
      'optimizedText',
      'translatedText',
    ],
    ...detail.segments.map((segment) => <String>[
          segment.id,
          segment.sourceText,
          segment.rawText ?? '',
          segment.optimizedText ?? '',
          segment.translatedText,
        ]),
  ];
  return rows.map((row) => row.map(_csvCell).join(',')).join('\n');
}

String _rawText(SessionSegment segment) {
  final raw = segment.rawText?.trim();
  return raw?.isNotEmpty == true ? raw! : segment.sourceText;
}

String _optimizedText(SessionSegment segment) {
  final optimized = segment.optimizedText?.trim();
  return optimized?.isNotEmpty == true ? optimized! : segment.sourceText;
}

String _csvCell(String value) {
  if (!value.contains(RegExp('[,"\n\r]'))) return value;
  return '"${value.replaceAll('"', '""')}"';
}

void _writeSegmentDiagnostics(StringBuffer buffer, SessionSegment segment) {
  final diagnostics = <String>[
    if (segment.sourceLanguage != null)
      'Source language: ${segment.sourceLanguage}',
    if (segment.targetLanguage != null)
      'Target language: ${segment.targetLanguage}',
    if (segment.confidence != null) 'Confidence: ${segment.confidence}',
    if (segment.stage != null) 'Stage: ${segment.stage}',
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
