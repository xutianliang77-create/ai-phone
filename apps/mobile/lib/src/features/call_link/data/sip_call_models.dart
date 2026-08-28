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
    this.carrierState,
    this.callGeneration,
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
  final String? carrierState;
  final int? callGeneration;

  SipOutboundCall withAir780Status(Air780CallStatus status) => SipOutboundCall(
        callId: callId,
        sessionId: sessionId,
        roomName: roomName,
        operationId: operationId,
        provider: provider,
        status: status.providerOperationStatus,
        replayed: replayed,
        participantIdentity: participantIdentity,
        providerCallId: status.providerCallId ?? providerCallId,
        carrierState: status.carrierState,
        callGeneration: status.callGeneration ?? callGeneration,
      );

  SipOutboundCall withProviderStatus(PhoneCallStatus status) =>
      withAir780Status(status);

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
      carrierState: json['carrierState'] as String?,
      callGeneration: json['callGeneration'] as int?,
    );
  }
}

typedef PhoneOutboundCall = SipOutboundCall;

class Air780CallStatus {
  const Air780CallStatus({
    required this.callId,
    required this.sessionId,
    required this.operationId,
    required this.provider,
    required this.providerOperationStatus,
    this.providerCallId,
    this.carrierState,
    this.callGeneration,
  });

  final String callId;
  final String sessionId;
  final String operationId;
  final String provider;
  final String providerOperationStatus;
  final String? providerCallId;
  final String? carrierState;
  final int? callGeneration;

  factory Air780CallStatus.fromJson(Map<String, Object?> json) {
    return Air780CallStatus(
      callId: json['callId']! as String,
      sessionId: json['sessionId']! as String,
      operationId: json['operationId']! as String,
      provider: json['provider']! as String,
      providerOperationStatus: json['providerOperationStatus']! as String,
      providerCallId: json['providerCallId'] as String?,
      carrierState: json['carrierState'] as String?,
      callGeneration: json['callGeneration'] as int?,
    );
  }
}

typedef PhoneCallStatus = Air780CallStatus;

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
