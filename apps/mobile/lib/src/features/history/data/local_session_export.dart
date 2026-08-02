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
  return detail.segments.map((segment) {
    return <String>[
      if (segment.speaker != null)
        'Speaker: ${segment.speaker!.label(isChinese: true)}',
      'Raw: ${_rawText(segment)}',
      'Optimized: ${_optimizedText(segment)}',
      'Translation: ${segment.translatedText}',
    ].join('\n');
  }).join('\n\n');
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
