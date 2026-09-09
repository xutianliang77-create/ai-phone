class RealtimeSession {
  const RealtimeSession({
    required this.sessionId,
    required this.realtimeToken,
    required this.endpoint,
    required this.expiresAt,
    required this.maxDurationSeconds,
    this.domainLexiconPacks = const <String>[],
    this.domainLexiconVersion,
    this.syncBinding,
    this.publicScopeNotice,
  });

  final String sessionId;
  final String realtimeToken;
  final Uri endpoint;
  final DateTime expiresAt;
  final int maxDurationSeconds;
  final List<String> domainLexiconPacks;
  final String? domainLexiconVersion;
  final ResultSyncBinding? syncBinding;
  final String? publicScopeNotice;

  factory RealtimeSession.fromJson(Map<String, Object?> json) {
    return RealtimeSession(
      sessionId: json['sessionId']! as String,
      realtimeToken: json['realtimeToken']! as String,
      endpoint: Uri.parse(json['endpoint']! as String),
      expiresAt: DateTime.parse(json['expiresAt']! as String),
      maxDurationSeconds: json['maxDurationSeconds']! as int,
      domainLexiconPacks: (json['domainLexiconPacks'] as List<Object?>?)
              ?.whereType<String>()
              .toList(growable: false) ??
          const <String>[],
      domainLexiconVersion: json['domainLexiconVersion'] as String?,
      syncBinding: json.containsKey('processing')
          ? ResultSyncBinding.fromJson(json)
          : null,
      publicScopeNotice: json['publicScopeNotice'] as String?,
    );
  }
}

class ResultSyncBinding {
  const ResultSyncBinding(
      {required this.deploymentId,
      required this.ownerId,
      required this.modelPolicyRevision,
      this.captureSampleRate = 24000});
  final String deploymentId, ownerId, modelPolicyRevision;
  final int captureSampleRate;
  factory ResultSyncBinding.fromJson(Map<String, Object?> json) {
    final p = json['processing'];
    if (p is! Map ||
        p['contractVersion'] != 1 ||
        p['processingMode'] != 'online' ||
        json['captureSampleRate'] is! int ||
        !const [16000, 24000].contains(json['captureSampleRate']) ||
        [json['deploymentId'], json['ownerId'], p['modelPolicyRevision']]
            .any((v) => v is! String || v.trim().isEmpty)) {
      throw const FormatException('Invalid public session identity');
    }
    return ResultSyncBinding(
        deploymentId: json['deploymentId'] as String,
        ownerId: json['ownerId'] as String,
        modelPolicyRevision: p['modelPolicyRevision'] as String,
        captureSampleRate: json['captureSampleRate'] as int);
  }
}
