class AiCallingAgentDraft {
  const AiCallingAgentDraft({
    required this.id,
    required this.scenario,
    required this.status,
    required this.objective,
    required this.suggestedScript,
    required this.language,
    required this.riskLevel,
    required this.riskReasons,
    this.targetName,
    this.targetPhone,
    this.consentPromptVersion,
    this.authorizedAt,
    this.takeoverRequestedAt,
    this.takeoverReadyAt,
    this.takeoverResolvedAt,
    this.takeoverReason,
    this.agentControlState = 'running',
    this.agentPausedAt,
    this.agentResumedAt,
    this.cancelledAt,
    this.cancellationReason,
    this.callId,
    this.providerCallId,
    this.executionProvider,
    this.carrierState,
    this.liveKitParticipantState,
    this.deviceId,
    this.callGeneration,
    this.queuedAt,
    this.startedAt,
    this.completedAt,
    this.failedAt,
    this.consumedSeconds,
    this.resultSummary,
    this.failureReason,
    this.nextStep,
  });

  final String id;
  final String scenario;
  final String status;
  final String objective;
  final String suggestedScript;
  final String language;
  final String riskLevel;
  final List<String> riskReasons;
  final String? targetName;
  final String? targetPhone;
  final String? consentPromptVersion;
  final String? authorizedAt;
  final String? takeoverRequestedAt;
  final String? takeoverReadyAt;
  final String? takeoverResolvedAt;
  final String? takeoverReason;
  final String agentControlState;
  final String? agentPausedAt;
  final String? agentResumedAt;
  final String? cancelledAt;
  final String? cancellationReason;
  final String? callId;
  final String? providerCallId;
  final String? executionProvider;
  final String? carrierState;
  final String? liveKitParticipantState;
  final String? deviceId;
  final int? callGeneration;
  final String? queuedAt;
  final String? startedAt;
  final String? completedAt;
  final String? failedAt;
  final int? consumedSeconds;
  final String? resultSummary;
  final String? failureReason;
  final String? nextStep;

  bool get requiresHumanTakeover =>
      status == 'requires_human_takeover' ||
      status == 'takeover_requested' ||
      riskLevel == 'requires_human_takeover';

  factory AiCallingAgentDraft.fromJson(Map<String, Object?> json) {
    return AiCallingAgentDraft(
      id: json['id']! as String,
      scenario: json['scenario']! as String,
      status: json['status']! as String,
      objective: json['objective']! as String,
      suggestedScript: json['suggestedScript']! as String,
      language: (json['language'] ?? 'zh') as String,
      riskLevel: (json['riskLevel'] ?? 'low') as String,
      riskReasons: _stringList(json['riskReasons']),
      targetName: json['targetName'] as String?,
      targetPhone: json['targetPhone'] as String?,
      consentPromptVersion: json['consentPromptVersion'] as String?,
      authorizedAt: json['authorizedAt'] as String?,
      takeoverRequestedAt: json['takeoverRequestedAt'] as String?,
      takeoverReadyAt: json['takeoverReadyAt'] as String?,
      takeoverResolvedAt: json['takeoverResolvedAt'] as String?,
      takeoverReason: json['takeoverReason'] as String?,
      agentControlState: (json['agentControlState'] ?? 'running') as String,
      agentPausedAt: json['agentPausedAt'] as String?,
      agentResumedAt: json['agentResumedAt'] as String?,
      cancelledAt: json['cancelledAt'] as String?,
      cancellationReason: json['cancellationReason'] as String?,
      callId: json['callId'] as String?,
      providerCallId: json['providerCallId'] as String?,
      executionProvider: json['executionProvider'] as String?,
      carrierState: json['carrierState'] as String?,
      liveKitParticipantState: json['liveKitParticipantState'] as String?,
      deviceId: json['deviceId'] as String?,
      callGeneration: json['callGeneration'] as int?,
      queuedAt: json['queuedAt'] as String?,
      startedAt: json['startedAt'] as String?,
      completedAt: json['completedAt'] as String?,
      failedAt: json['failedAt'] as String?,
      consumedSeconds: (json['consumedSeconds'] as num?)?.toInt(),
      resultSummary: json['resultSummary'] as String?,
      failureReason: json['failureReason'] as String?,
      nextStep: json['nextStep'] as String?,
    );
  }

  static List<String> _stringList(Object? value) {
    if (value is! List) return const <String>[];
    return value.whereType<String>().toList(growable: false);
  }
}
