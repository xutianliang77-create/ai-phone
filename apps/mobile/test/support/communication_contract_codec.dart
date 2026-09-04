class CommunicationContractEnvelope {
  CommunicationContractEnvelope._(this.json);

  final Map<String, Object?> json;

  factory CommunicationContractEnvelope.fromJson(Map<String, Object?> input) {
    final normalized = Map<String, Object?>.from(input);
    if (normalized['contractVersion'] != 1) {
      throw const FormatException('Unsupported communication contractVersion');
    }
    final kind = normalized['kind'];
    if (kind != 'command' && kind != 'event') {
      throw const FormatException('Invalid communication kind');
    }
    _requiredText(normalized, 'sessionId');
    for (final id in const [
      'speechId',
      'participantId',
      'roomId',
      'legId',
      'turnId',
      'segmentId',
      'playbackId',
      'workId',
      'deliveryAttemptId',
      'agentRunId',
      'providerOperationId',
    ]) {
      if (normalized[id] != null) {
        _requiredText(normalized, id);
      }
    }
    _requiredText(normalized, kind == 'command' ? 'commandId' : 'eventId');
    if (!normalized.containsKey('payload')) {
      throw const FormatException('Communication payload is required');
    }
    if (kind == 'command') {
      _nonNegativeInteger(normalized, 'expectedVersion');
      _timestamp(normalized, 'issuedAt');
      if (normalized['deadlineAt'] != null) {
        _timestamp(normalized, 'deadlineAt');
      }
      final actorValue = normalized['actor'];
      if (actorValue is! Map ||
          !const ['user', 'service', 'agent', 'system'].contains(actorValue['type'])) {
        throw const FormatException('Invalid communication actor');
      }
      final actor = actorValue.cast<String, Object?>();
      _requiredText(actor, 'id');
      normalized['actor'] = actor;
    } else {
      _positiveInteger(normalized, 'eventVersion');
      _nonNegativeInteger(normalized, 'aggregateVersion');
      _nonNegativeInteger(normalized, 'sequence');
      _requiredText(normalized, 'eventType');
      _requiredText(normalized, 'producer');
      _requiredText(normalized, 'traceId');
      _timestamp(normalized, 'occurredAt');
    }
    _requiredText(normalized, 'idempotencyKey', max: 240);
    return CommunicationContractEnvelope._(normalized);
  }

  Map<String, Object?> toJson() => Map<String, Object?>.from(json);
}

void _requiredText(Map<String, Object?> input, String key, {int max = 160}) {
  final value = input[key];
  if (value is! String || value.trim().isEmpty || value.length > max) {
    throw FormatException('Invalid communication $key');
  }
  input[key] = value.trim();
}

void _nonNegativeInteger(Map<String, Object?> input, String key) {
  final value = input[key];
  if (value is! int || value < 0) {
    throw FormatException('Invalid communication $key');
  }
}

void _positiveInteger(Map<String, Object?> input, String key) {
  final value = input[key];
  if (value is! int || value < 1) {
    throw FormatException('Invalid communication $key');
  }
}

void _timestamp(Map<String, Object?> input, String key) {
  _requiredText(input, key, max: 64);
  if (DateTime.tryParse(input[key] as String) == null) {
    throw FormatException('Invalid communication $key');
  }
}
