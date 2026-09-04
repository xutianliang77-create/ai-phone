class CallLink {
  const CallLink({
    required this.callId,
    required this.sessionId,
    required this.roomName,
    required this.roomProvider,
    required this.joinUrl,
    required this.hostUrl,
    required this.status,
    required this.expiresAt,
    this.activeGuestCount = 0,
  });

  final String callId;
  final String sessionId;
  final String roomName;
  final String roomProvider;
  final String joinUrl;
  final String hostUrl;
  final String status;
  final DateTime expiresAt;
  final int activeGuestCount;

  CallLink withJoinUrl(String value) => CallLink(
        callId: callId,
        sessionId: sessionId,
        roomName: roomName,
        roomProvider: roomProvider,
        joinUrl: value,
        hostUrl: hostUrl,
        status: status,
        expiresAt: expiresAt,
        activeGuestCount: activeGuestCount,
      );

  factory CallLink.fromJson(Map<String, Object?> json) {
    return CallLink(
      callId: json['callId']! as String,
      sessionId: (json['sessionId'] ?? json['callId'])! as String,
      roomName: json['roomName']! as String,
      roomProvider: json['roomProvider']! as String,
      joinUrl: json['joinUrl']! as String,
      hostUrl: json['hostUrl']! as String,
      status: json['status']! as String,
      expiresAt: DateTime.parse(json['expiresAt']! as String),
      activeGuestCount: (json['activeGuestCount'] as num?)?.toInt() ?? 0,
    );
  }
}

class CallLinkEndResult {
  const CallLinkEndResult({
    required this.callId,
    required this.sessionId,
    required this.status,
    required this.consumedSeconds,
    required this.endedAt,
  });

  final String callId;
  final String sessionId;
  final String status;
  final int consumedSeconds;
  final DateTime? endedAt;

  factory CallLinkEndResult.fromJson(Map<String, Object?> json) {
    final endedAt = json['endedAt'];
    return CallLinkEndResult(
      callId: json['callId']! as String,
      sessionId: json['sessionId']! as String,
      status: json['status']! as String,
      consumedSeconds: json['consumedSeconds']! as int,
      endedAt: endedAt is String ? DateTime.parse(endedAt) : null,
    );
  }
}

class TranslationCallControlResult {
  const TranslationCallControlResult({
    required this.callId,
    required this.sessionId,
    required this.operationId,
    required this.operationType,
    required this.status,
    required this.replayed,
    required this.controlGeneration,
    required this.uplinkPaused,
  });

  final String callId;
  final String sessionId;
  final String operationId;
  final String operationType;
  final String status;
  final bool replayed;
  final int controlGeneration;
  final bool uplinkPaused;

  bool get isTerminal =>
      status == 'succeeded' || status == 'failed' || status == 'cancelled';

  factory TranslationCallControlResult.fromJson(
    Map<String, Object?> json,
  ) {
    return TranslationCallControlResult(
      callId: json['callId']! as String,
      sessionId: json['sessionId']! as String,
      operationId: json['operationId']! as String,
      operationType: json['operationType']! as String,
      status: json['status']! as String,
      replayed: json['replayed'] == true,
      controlGeneration: (json['controlGeneration']! as num).toInt(),
      uplinkPaused: json['uplinkPaused'] == true,
    );
  }
}

class CallDiagnosticMarkerResult {
  const CallDiagnosticMarkerResult({
    required this.callId,
    required this.sessionId,
    required this.markerId,
    required this.category,
    required this.createdAt,
    required this.replayed,
  });

  final String callId;
  final String sessionId;
  final String markerId;
  final String category;
  final DateTime createdAt;
  final bool replayed;

  factory CallDiagnosticMarkerResult.fromJson(Map<String, Object?> json) {
    return CallDiagnosticMarkerResult(
      callId: json['callId']! as String,
      sessionId: json['sessionId']! as String,
      markerId: json['markerId']! as String,
      category: json['category']! as String,
      createdAt: DateTime.parse(json['createdAt']! as String),
      replayed: json['replayed'] == true,
    );
  }
}

class CallRoomToken {
  const CallRoomToken({
    required this.callId,
    required this.provider,
    required this.roomName,
    required this.wsUrl,
    required this.participantIdentity,
    required this.participantRole,
    required this.token,
    required this.expiresAt,
    this.fullDuplexEnabled = false,
  });

  final String callId;
  final String provider;
  final String roomName;
  final String wsUrl;
  final String participantIdentity;
  final String participantRole;
  final String token;
  final DateTime expiresAt;
  final bool fullDuplexEnabled;

  factory CallRoomToken.fromJson(Map<String, Object?> json) {
    return CallRoomToken(
      callId: json['callId']! as String,
      provider: json['provider']! as String,
      roomName: json['roomName']! as String,
      wsUrl: json['wsUrl']! as String,
      participantIdentity: json['participantIdentity']! as String,
      participantRole: json['participantRole']! as String,
      token: json['token']! as String,
      expiresAt: DateTime.parse(json['expiresAt']! as String),
      fullDuplexEnabled: json['fullDuplexEnabled'] == true,
    );
  }
}
