class GatewayRealtimeEvent {
  const GatewayRealtimeEvent({
    required this.type,
    this.sessionId,
    this.segmentId,
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
  });

  final String type;
  final String? sessionId;
  final String? segmentId;
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

  const GatewayRealtimeEvent.connection({
    required this.type,
    this.message,
  })  : sessionId = null,
        segmentId = null,
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
        data = null;

  factory GatewayRealtimeEvent.fromJson(Map<String, Object?> json) {
    final providerUsage = json['providerUsage'] is Map<String, Object?>
        ? json['providerUsage']! as Map<String, Object?>
        : null;
    return GatewayRealtimeEvent(
      type: json['type']! as String,
      sessionId: json['sessionId'] as String?,
      segmentId: json['segmentId'] as String?,
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
    );
  }
}
