import '../../domain/entities/subtitle_segment.dart';
import '../../../../shared/domain/speaker_attribution.dart';

class SegmentDraft {
  const SegmentDraft(
    this.id, {
    this.sourceText = '',
    this.translatedText = '',
    this.turnId,
    this.revision,
    this.rawText,
    this.optimizedText,
    this.sourceLanguage,
    this.targetLanguage,
    this.confidence,
    this.stage,
    this.provider,
    this.model,
    this.latencyMs,
    this.refinement,
    this.speaker,
    this.timing,
  });

  final String id;
  final String? turnId;
  final int? revision;
  final String sourceText;
  final String translatedText;
  final String? rawText;
  final String? optimizedText;
  final String? sourceLanguage;
  final String? targetLanguage;
  final double? confidence;
  final String? stage;
  final String? provider;
  final String? model;
  final int? latencyMs;
  final Map<String, Object?>? refinement;
  final SpeakerAttribution? speaker;
  final SegmentTiming? timing;

  SegmentDraft copyWith({
    String? sourceText,
    String? translatedText,
    String? turnId,
    int? revision,
    String? rawText,
    String? optimizedText,
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
  }) {
    return SegmentDraft(
      id,
      sourceText: sourceText ?? this.sourceText,
      translatedText: translatedText ?? this.translatedText,
      turnId: turnId ?? this.turnId,
      revision: revision ?? this.revision,
      rawText: rawText ?? this.rawText,
      optimizedText: optimizedText ?? this.optimizedText,
      sourceLanguage: sourceLanguage ?? this.sourceLanguage,
      targetLanguage: targetLanguage ?? this.targetLanguage,
      confidence: confidence ?? this.confidence,
      stage: stage ?? this.stage,
      provider: provider ?? this.provider,
      model: model ?? this.model,
      latencyMs: latencyMs ?? this.latencyMs,
      refinement: refinement ?? this.refinement,
      speaker: speaker ?? this.speaker,
      timing: timing ?? this.timing,
    );
  }

  SubtitleSegment toSegment() {
    return SubtitleSegment(
      id: id,
      turnId: turnId,
      revision: revision,
      sourceText: sourceText,
      translatedText: translatedText,
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
      speaker: speaker,
      timing: timing,
    );
  }
}
