class RealtimeSession {
  const RealtimeSession({
    required this.sessionId,
    required this.realtimeToken,
    required this.endpoint,
    required this.expiresAt,
    required this.maxDurationSeconds,
    this.domainLexiconPacks = const <String>[],
    this.domainLexiconVersion,
    this.controlBinding,
  });

  final String sessionId;
  final String realtimeToken;
  final Uri endpoint;
  final DateTime expiresAt;
  final int maxDurationSeconds;
  final List<String> domainLexiconPacks;
  final String? domainLexiconVersion;
  final Map<String, Object?>? controlBinding;

  factory RealtimeSession.fromJson(Map<String, Object?> json) {
    return RealtimeSession(
      controlBinding: json['controlBinding'] is Map
          ? Map<String, Object?>.from(json['controlBinding']! as Map)
          : null,
      sessionId: json['sessionId']! as String,
      realtimeToken: json['realtimeToken']! as String,
      endpoint: Uri.parse(json['endpoint']! as String),
      expiresAt: DateTime.parse(json['expiresAt']! as String),
      maxDurationSeconds: json['maxDurationSeconds']! as int,
      domainLexiconPacks:
          (json['domainLexiconPacks'] as List<Object?>?)
              ?.whereType<String>()
              .toList(growable: false) ??
          const <String>[],
      domainLexiconVersion: json['domainLexiconVersion'] as String?,
    );
  }
}
