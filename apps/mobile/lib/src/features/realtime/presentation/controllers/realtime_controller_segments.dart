part of 'realtime_controller.dart';

extension RealtimeControllerSegments on RealtimeController {
  void _upsertSegment(
    String id, {
    String? sourceText,
    String? translatedText,
    String? turnId,
    int? revision,
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
    SpeakerAttribution? speaker,
    SegmentTiming? timing,
    Map<String, Object?>? vadContext,
    TurnLanguageProfile? languageProfile,
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
    if (nextTranslatedText != null &&
        revision != null &&
        current.recognitionRevision != null &&
        revision < current.recognitionRevision!) {
      return;
    }
    final isRecognitionUpdate =
        nextSourceText != null || nextAppendSourceText != null;
    final canApplyEventRevision = revision == null ||
        current.revision == null ||
        revision >= current.revision!;
    final canReviseRecognition = isRecognitionUpdate
        ? revision == null ||
            current.recognitionRevision == null ||
            revision >= current.recognitionRevision!
        : canApplyEventRevision;
    final isNewerRecognitionRevision = nextSourceText != null &&
        revision != null &&
        current.recognitionRevision != null &&
        revision > current.recognitionRevision!;
    final nextRevision = revision == null
        ? current.revision
        : current.revision == null || revision > current.revision!
            ? revision
            : current.revision;
    _drafts[id] = current.copyWith(
      turnId: current.turnId ?? turnId,
      revision: nextRevision,
      recognitionRevision:
          nextSourceText != null && canReviseRecognition ? revision : null,
      sourceText: canReviseRecognition
          ? nextSourceText ?? current.sourceText + (nextAppendSourceText ?? '')
          : current.sourceText,
      translatedText: nextTranslatedText ??
          current.translatedText + (nextAppendTranslatedText ?? ''),
      rawText: canReviseRecognition ? rawText : null,
      optimizedText: canReviseRecognition ? optimizedText : null,
      sourceLanguage: canReviseRecognition ? sourceLanguage : null,
      targetLanguage: targetLanguage,
      confidence: canReviseRecognition ? confidence : null,
      stage: stage,
      provider: provider,
      model: model,
      latencyMs: latencyMs,
      refinement: canReviseRecognition ? refinement : null,
      speaker: canReviseRecognition ? speaker : null,
      timing: canReviseRecognition ? timing : null,
      vadContext: canReviseRecognition ? vadContext : null,
      languageProfile: canReviseRecognition ? languageProfile : null,
      clearTranslation: isNewerRecognitionRevision,
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
