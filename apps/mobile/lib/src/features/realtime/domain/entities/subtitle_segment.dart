import '../../../../shared/domain/speaker_attribution.dart';
import '../../../../shared/domain/turn_language_profile.dart';

class SubtitleSegment {
  const SubtitleSegment({
    required this.id,
    required this.sourceText,
    required this.translatedText,
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
    this.languageProfile,
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
  final TurnLanguageProfile? languageProfile;
}
