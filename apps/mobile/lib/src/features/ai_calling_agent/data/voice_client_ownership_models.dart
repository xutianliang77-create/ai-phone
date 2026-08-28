class VoiceClientOwnership {
  const VoiceClientOwnership({
    required this.sessionId,
    required this.legId,
    required this.accountId,
    required this.clientInstanceId,
    required this.participantIdentity,
    required this.generation,
    required this.leaseId,
    required this.leaseExpiresAt,
    required this.state,
    required this.version,
    required this.updatedAt,
  });

  final String sessionId;
  final String legId;
  final String accountId;
  final String clientInstanceId;
  final String participantIdentity;
  final int generation;
  final String leaseId;
  final DateTime leaseExpiresAt;
  final String state;
  final int version;
  final DateTime updatedAt;

  bool controls(String clientId, String participantId, DateTime now) =>
      state == 'active' &&
      leaseExpiresAt.isAfter(now) &&
      clientInstanceId == clientId &&
      participantIdentity == participantId;

  factory VoiceClientOwnership.fromJson(Map<String, Object?> json) {
    final state = _text(json, 'state');
    if (!const <String>{'active', 'released'}.contains(state)) {
      throw const FormatException('Invalid voice ownership response');
    }
    return VoiceClientOwnership(
      sessionId: _text(json, 'sessionId'),
      legId: _text(json, 'legId'),
      accountId: _text(json, 'accountId'),
      clientInstanceId: _text(json, 'clientInstanceId'),
      participantIdentity: _text(json, 'participantIdentity'),
      generation: _integer(json, 'generation'),
      leaseId: _text(json, 'leaseId'),
      leaseExpiresAt: _time(json, 'leaseExpiresAt'),
      state: state,
      version: _integer(json, 'version'),
      updatedAt: _time(json, 'updatedAt'),
    );
  }
}

class VoiceClientTakeover {
  const VoiceClientTakeover({
    required this.takeoverId,
    required this.expectedGeneration,
    required this.status,
    required this.expiresAt,
  });

  final String takeoverId;
  final int expectedGeneration;
  final String status;
  final DateTime expiresAt;

  factory VoiceClientTakeover.fromJson(Map<String, Object?> json) {
    final status = _text(json, 'status');
    if (!const <String>{
      'pending', 'confirmed', 'cancelled', 'expired',
    }.contains(status)) {
      throw const FormatException('Invalid voice ownership response');
    }
    return VoiceClientTakeover(
      takeoverId: _text(json, 'takeoverId'),
      expectedGeneration: _integer(json, 'expectedGeneration'),
      status: status,
      expiresAt: _time(json, 'expiresAt'),
    );
  }
}

String _text(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! String || value.trim().isEmpty) {
    throw const FormatException('Invalid voice ownership response');
  }
  return value;
}

int _integer(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! num || value.toInt() < 1 || value.toInt() != value) {
    throw const FormatException('Invalid voice ownership response');
  }
  return value.toInt();
}

DateTime _time(Map<String, Object?> json, String key) {
  final value = DateTime.tryParse(_text(json, key));
  if (value == null) {
    throw const FormatException('Invalid voice ownership response');
  }
  return value.toUtc();
}
