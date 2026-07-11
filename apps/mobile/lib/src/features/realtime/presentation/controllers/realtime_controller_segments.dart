part of 'realtime_controller.dart';

extension RealtimeControllerSegments on RealtimeController {
  void _upsertSegment(
    String id, {
    String? sourceText,
    String? translatedText,
    String? rawText,
    String? optimizedText,
    String? appendSourceText,
    String? appendTranslatedText,
    String? sourceLanguage,
    String? targetLanguage,
    double? confidence,
    String? stage,
    String? provider,
    String? model,
    int? latencyMs,
    Map<String, Object?>? refinement,
  }) {
    final nextSourceText = _cleanRealtimeText(sourceText);
    final nextTranslatedText = _cleanRealtimeText(translatedText);
    final nextAppendSourceText = _cleanRealtimeText(appendSourceText);
    final nextAppendTranslatedText = _cleanRealtimeText(appendTranslatedText);
    if (sourceText != null && nextSourceText == null) {
      _removeSegment(id);
      return;
    }
    if (translatedText != null && nextTranslatedText == null) return;
    if (appendSourceText != null && nextAppendSourceText == null) return;
    if (appendTranslatedText != null && nextAppendTranslatedText == null) {
      return;
    }

    final current = _drafts[id] ?? SegmentDraft(id);
    _drafts[id] = current.copyWith(
      sourceText:
          nextSourceText ?? current.sourceText + (nextAppendSourceText ?? ''),
      translatedText: nextTranslatedText ??
          current.translatedText + (nextAppendTranslatedText ?? ''),
      rawText: rawText,
      optimizedText: optimizedText,
      sourceLanguage: sourceLanguage,
      targetLanguage: targetLanguage,
      confidence: confidence,
      stage: stage,
      provider: provider,
      model: model,
      latencyMs: latencyMs,
      refinement: refinement,
    );
    _replaceSegmentsFromDrafts();
  }

  void _removeSegment(String id) {
    if (_drafts.remove(id) == null) return;
    _replaceSegmentsFromDrafts();
  }
}

String? _cleanRealtimeText(String? text) {
  if (text == null) return null;
  final stripped = text.replaceAll(_realtimeMarkerPattern, ' ');
  final collapsed = stripped.replaceAll(RegExp(r'\s+'), ' ').trim();
  return _isIgnorableRealtimeText(collapsed) ? null : collapsed;
}

bool _isIgnorableRealtimeText(String text) {
  final compact =
      text.toLowerCase().replaceAll(RegExp(r'[\s,，.。!！?？;；:：、\-_\/|]+'), '');
  return compact.isEmpty || _ignorableRealtimeTexts.contains(compact);
}

final _realtimeMarkerPattern = RegExp(
  r'(?:<|\[|\()(?:\|?\s*)?(?:sil|noise|blank|unk|nospeech|no[\s_-]*speech|inaudible)(?:\s*\|?)?(?:>|\]|\))',
  caseSensitive: false,
);

const _ignorableRealtimeTexts = <String>{
  'sil',
  'noise',
  'blank',
  'unk',
  'nospeech',
  'nonspeech',
  'inaudible',
};
