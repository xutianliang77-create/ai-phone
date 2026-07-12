import '../../../shared/domain/speaker_attribution.dart';

class SessionListItem {
  const SessionListItem({
    required this.sessionId,
    required this.mode,
    required this.status,
    required this.consumedSeconds,
    required this.createdAt,
    required this.segmentCount,
    this.endedAt,
  });

  final String sessionId;
  final String mode;
  final String status;
  final int consumedSeconds;
  final DateTime createdAt;
  final DateTime? endedAt;
  final int segmentCount;

  factory SessionListItem.fromJson(Map<String, Object?> json) {
    return SessionListItem(
      sessionId: json['sessionId']! as String,
      mode: json['mode']! as String,
      status: json['status']! as String,
      consumedSeconds: json['consumedSeconds']! as int,
      createdAt: DateTime.parse(json['createdAt']! as String),
      endedAt: json['endedAt'] == null
          ? null
          : DateTime.parse(json['endedAt']! as String),
      segmentCount: json['segmentCount']! as int,
    );
  }
}

class SessionSegment {
  const SessionSegment({
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

  factory SessionSegment.fromJson(Map<String, Object?> json) {
    return SessionSegment(
      id: json['id']! as String,
      turnId: json['turnId'] as String?,
      revision: (json['revision'] as num?)?.toInt(),
      sourceText: json['sourceText']! as String,
      translatedText: json['translatedText']! as String,
      rawText: json['rawText'] as String?,
      optimizedText: json['optimizedText'] as String?,
      sourceLanguage: json['sourceLanguage'] as String?,
      targetLanguage: json['targetLanguage'] as String?,
      confidence: (json['confidence'] as num?)?.toDouble(),
      stage: json['stage'] as String?,
      provider: json['provider'] as String?,
      model: json['model'] as String?,
      latencyMs: (json['latencyMs'] as num?)?.toInt(),
      refinement: json['refinement'] is Map<String, Object?>
          ? json['refinement']! as Map<String, Object?>
          : null,
      speaker: json['speaker'] is Map
          ? SpeakerAttribution.fromJson(
              Map<String, Object?>.from(json['speaker']! as Map),
            )
          : null,
      timing: json['timing'] is Map
          ? SegmentTiming.fromJson(
              Map<String, Object?>.from(json['timing']! as Map),
            )
          : null,
    );
  }

  SessionSegment copyWithSpeaker(SpeakerAttribution nextSpeaker) {
    return SessionSegment(
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
      speaker: nextSpeaker,
      timing: timing,
    );
  }
}

class SessionDetail extends SessionListItem {
  const SessionDetail({
    required super.sessionId,
    required super.mode,
    required super.status,
    required super.consumedSeconds,
    required super.createdAt,
    required super.segmentCount,
    required this.segments,
    this.reviewJson,
    super.endedAt,
  });

  final List<SessionSegment> segments;
  final Map<String, Object?>? reviewJson;

  factory SessionDetail.fromJson(Map<String, Object?> json) {
    return SessionDetail(
      sessionId: json['sessionId']! as String,
      mode: json['mode']! as String,
      status: json['status']! as String,
      consumedSeconds: json['consumedSeconds']! as int,
      createdAt: DateTime.parse(json['createdAt']! as String),
      endedAt: json['endedAt'] == null
          ? null
          : DateTime.parse(json['endedAt']! as String),
      segmentCount: json['segmentCount']! as int,
      segments: (json['segments']! as List<dynamic>)
          .cast<Map<String, Object?>>()
          .map(SessionSegment.fromJson)
          .toList(),
      reviewJson: json['review'] == null
          ? null
          : (json['review']! as Map<String, Object?>),
    );
  }

  SessionDetail copyWithSegments(List<SessionSegment> nextSegments) {
    return SessionDetail(
      sessionId: sessionId,
      mode: mode,
      status: status,
      consumedSeconds: consumedSeconds,
      createdAt: createdAt,
      endedAt: endedAt,
      segmentCount: nextSegments.length,
      segments: nextSegments,
      reviewJson: reviewJson,
    );
  }
}

class SessionExport {
  const SessionExport({
    required this.sessionId,
    required this.filename,
    required this.mimeType,
    required this.content,
  });

  final String sessionId;
  final String filename;
  final String mimeType;
  final String content;

  factory SessionExport.fromJson(Map<String, Object?> json) {
    return SessionExport(
      sessionId: json['sessionId']! as String,
      filename: json['filename']! as String,
      mimeType: json['mimeType']! as String,
      content: json['content']! as String,
    );
  }
}

class TermbaseTerm {
  const TermbaseTerm({
    required this.id,
    required this.sourceText,
    required this.translatedText,
    required this.sourceLanguage,
    required this.targetLanguage,
    required this.status,
  });

  final String id;
  final String sourceText;
  final String translatedText;
  final String sourceLanguage;
  final String targetLanguage;
  final String status;

  factory TermbaseTerm.fromJson(Map<String, Object?> json) {
    return TermbaseTerm(
      id: json['id']! as String,
      sourceText: json['sourceText']! as String,
      translatedText: json['translatedText']! as String,
      sourceLanguage: json['sourceLanguage']! as String,
      targetLanguage: json['targetLanguage']! as String,
      status: json['status']! as String,
    );
  }
}
