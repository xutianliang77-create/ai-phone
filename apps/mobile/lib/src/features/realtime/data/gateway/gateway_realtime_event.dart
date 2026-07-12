import '../../../../shared/domain/speaker_attribution.dart';

class GatewayRealtimeEvent {
  const GatewayRealtimeEvent({
    required this.type,
    this.sessionId,
    this.segmentId,
    this.turnId,
    this.revision,
    this.text,
    this.rawText,
    this.optimizedText,
    this.language,
    this.confidence,
    this.message,
    this.code,
    this.stage,
    this.provider,
    this.model,
    this.latencyMs,
    this.refinement,
    this.retryable,
    this.reason,
    this.billableSeconds,
    this.remainingSeconds,
    this.lowBalance,
    this.format,
    this.sampleRate,
    this.sequence,
    this.data,
    this.flush,
    this.speaker,
    this.timing,
  });

  final String type;
  final String? sessionId;
  final String? segmentId;
  final String? turnId;
  final int? revision;
  final String? text;
  final String? rawText;
  final String? optimizedText;
  final String? language;
  final double? confidence;
  final String? message;
  final String? code;
  final String? stage;
  final String? provider;
  final String? model;
  final int? latencyMs;
  final Map<String, Object?>? refinement;
  final bool? retryable;
  final String? reason;
  final int? billableSeconds;
  final int? remainingSeconds;
  final bool? lowBalance;
  final String? format;
  final int? sampleRate;
  final int? sequence;
  final String? data;
  final GatewayRealtimeFlushSummary? flush;
  final SpeakerAttribution? speaker;
  final SegmentTiming? timing;

  const GatewayRealtimeEvent.connection({
    required this.type,
    this.message,
  })  : sessionId = null,
        segmentId = null,
        turnId = null,
        revision = null,
        text = null,
        rawText = null,
        optimizedText = null,
        language = null,
        confidence = null,
        code = null,
        stage = 'connection',
        provider = null,
        model = null,
        latencyMs = null,
        refinement = null,
        retryable = true,
        reason = null,
        billableSeconds = null,
        remainingSeconds = null,
        lowBalance = null,
        format = null,
        sampleRate = null,
        sequence = null,
        data = null,
        flush = null,
        speaker = null,
        timing = null;

  factory GatewayRealtimeEvent.fromJson(Map<String, Object?> json) {
    final providerUsage = json['providerUsage'] is Map<String, Object?>
        ? json['providerUsage']! as Map<String, Object?>
        : null;
    final flushJson = json['flush'];
    return GatewayRealtimeEvent(
      type: json['type']! as String,
      sessionId: json['sessionId'] as String?,
      segmentId: json['segmentId'] as String?,
      turnId: json['turnId'] as String?,
      revision: (json['revision'] as num?)?.toInt(),
      text: json['text'] as String?,
      rawText: json['rawText'] as String?,
      optimizedText: json['optimizedText'] as String?,
      language: json['language'] as String?,
      confidence: (json['confidence'] as num?)?.toDouble(),
      message: json['message'] as String?,
      code: json['code'] as String?,
      stage: json['stage'] as String?,
      provider:
          json['provider'] as String? ?? providerUsage?['provider'] as String?,
      model: json['model'] as String? ?? providerUsage?['model'] as String?,
      latencyMs: (json['latencyMs'] as num?)?.toInt() ??
          (providerUsage?['latencyMs'] as num?)?.toInt(),
      refinement: json['refinement'] is Map<String, Object?>
          ? json['refinement']! as Map<String, Object?>
          : null,
      retryable: json['retryable'] as bool?,
      reason: json['reason'] as String?,
      billableSeconds: json['billableSeconds'] as int?,
      remainingSeconds: json['remainingSeconds'] as int?,
      lowBalance: json['lowBalance'] as bool?,
      format: json['format'] as String?,
      sampleRate: (json['sampleRate'] as num?)?.toInt(),
      sequence: (json['sequence'] as num?)?.toInt(),
      data: json['data'] as String?,
      flush: flushJson is Map
          ? GatewayRealtimeFlushSummary.fromJson(
              Map<String, Object?>.from(flushJson),
            )
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
}

class GatewayRealtimeFlushSummary {
  const GatewayRealtimeFlushSummary({
    required this.status,
    required this.transcriptFinalCount,
    required this.translationFinalCount,
    required this.translationFailedCount,
    required this.unresolvedSegmentCount,
    required this.pipelineErrorCount,
    required this.audioFlushed,
    required this.providerFlushed,
  });

  final String status;
  final int transcriptFinalCount;
  final int translationFinalCount;
  final int translationFailedCount;
  final int unresolvedSegmentCount;
  final int pipelineErrorCount;
  final bool audioFlushed;
  final bool providerFlushed;

  bool get isSuccessful =>
      (status == 'completed' || status == 'empty') &&
      audioFlushed &&
      providerFlushed &&
      unresolvedSegmentCount == 0 &&
      translationFailedCount == 0 &&
      pipelineErrorCount == 0;

  factory GatewayRealtimeFlushSummary.fromJson(Map<String, Object?> json) {
    return GatewayRealtimeFlushSummary(
      status: json['status'] as String? ?? 'degraded',
      transcriptFinalCount:
          (json['transcriptFinalCount'] as num?)?.toInt() ?? 0,
      translationFinalCount:
          (json['translationFinalCount'] as num?)?.toInt() ?? 0,
      translationFailedCount:
          (json['translationFailedCount'] as num?)?.toInt() ?? 0,
      unresolvedSegmentCount:
          (json['unresolvedSegmentCount'] as num?)?.toInt() ?? 0,
      pipelineErrorCount: (json['pipelineErrorCount'] as num?)?.toInt() ?? 0,
      audioFlushed: json['audioFlushed'] as bool? ?? false,
      providerFlushed: json['providerFlushed'] as bool? ?? false,
    );
  }
}
