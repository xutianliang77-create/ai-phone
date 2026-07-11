class RealtimeSession {
  const RealtimeSession({
    required this.sessionId,
    required this.realtimeToken,
    required this.endpoint,
    required this.expiresAt,
    required this.maxDurationSeconds,
  });

  final String sessionId;
  final String realtimeToken;
  final Uri endpoint;
  final DateTime expiresAt;
  final int maxDurationSeconds;

  factory RealtimeSession.fromJson(Map<String, Object?> json) {
    return RealtimeSession(
      sessionId: json['sessionId']! as String,
      realtimeToken: json['realtimeToken']! as String,
      endpoint: Uri.parse(json['endpoint']! as String),
      expiresAt: DateTime.parse(json['expiresAt']! as String),
      maxDurationSeconds: json['maxDurationSeconds']! as int,
    );
  }
}
