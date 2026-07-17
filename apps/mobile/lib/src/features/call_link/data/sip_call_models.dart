class SipOutboundCall {
  const SipOutboundCall({
    required this.callId,
    required this.sessionId,
    required this.roomName,
    required this.operationId,
    required this.provider,
    required this.status,
    required this.replayed,
    this.participantIdentity,
    this.providerCallId,
  });

  final String callId;
  final String sessionId;
  final String roomName;
  final String operationId;
  final String provider;
  final String status;
  final bool replayed;
  final String? participantIdentity;
  final String? providerCallId;

  factory SipOutboundCall.fromJson(Map<String, Object?> json) {
    return SipOutboundCall(
      callId: json['callId']! as String,
      sessionId: json['sessionId']! as String,
      roomName: json['roomName']! as String,
      operationId: json['operationId']! as String,
      provider: json['provider']! as String,
      status: json['status']! as String,
      replayed: json['replayed'] == true,
      participantIdentity: json['participantIdentity'] as String?,
      providerCallId: json['providerCallId'] as String?,
    );
  }
}

class SipControlResult {
  const SipControlResult({
    required this.operationId,
    required this.operationType,
    required this.status,
    required this.replayed,
  });

  final String operationId;
  final String operationType;
  final String status;
  final bool replayed;

  factory SipControlResult.fromJson(Map<String, Object?> json) {
    return SipControlResult(
      operationId: json['operationId']! as String,
      operationType: json['operationType']! as String,
      status: json['status']! as String,
      replayed: json['replayed'] == true,
    );
  }
}
