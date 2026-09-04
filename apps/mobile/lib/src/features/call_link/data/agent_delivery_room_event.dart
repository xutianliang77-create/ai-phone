import 'dart:convert';

const agentDeliveryRoomTopic = 'agent.delivery.v1';

const _lifecycleTypes = <String>{
  'agent.delivery.queued',
  'agent.delivery.started',
  'agent.delivery.ended',
  'agent.delivery.interrupted',
  'agent.delivery.failed',
};

class AgentDeliveryRoomEvent {
  const AgentDeliveryRoomEvent({
    required this.eventId,
    required this.type,
    required this.deliveryAttemptId,
    required this.workId,
    required this.sessionId,
    required this.legId,
    required this.turnId,
    required this.turnGeneration,
    required this.dispatchGeneration,
    required this.clientInstanceId,
    required this.clientParticipantIdentity,
    required this.workerParticipantIdentity,
    required this.ownershipLeaseId,
    required this.ownershipGeneration,
    required this.playbackId,
    required this.playbackGeneration,
    required this.occurredAt,
    this.failureCode,
  });

  final String eventId;
  final String type;
  final String deliveryAttemptId;
  final String workId;
  final String sessionId;
  final String legId;
  final String turnId;
  final int turnGeneration;
  final int dispatchGeneration;
  final String clientInstanceId;
  final String clientParticipantIdentity;
  final String workerParticipantIdentity;
  final String ownershipLeaseId;
  final int ownershipGeneration;
  final String playbackId;
  final int playbackGeneration;
  final DateTime occurredAt;
  final String? failureCode;

  bool matchesClient(String instanceId, String participantIdentity) =>
      clientInstanceId == instanceId &&
      clientParticipantIdentity == participantIdentity;

  Map<String, Object?> receipt({
    required String receiptId,
    required String receiptType,
    required DateTime occurredAt,
    String? failureCode,
  }) => <String, Object?>{
        'version': 1,
        'receiptId': receiptId,
        'type': receiptType,
        'sessionId': sessionId,
        'legId': legId,
        'turnId': turnId,
        'workId': workId,
        'deliveryAttemptId': deliveryAttemptId,
        'playbackId': playbackId,
        'clientInstanceId': clientInstanceId,
        'clientParticipantIdentity': clientParticipantIdentity,
        'workerParticipantIdentity': workerParticipantIdentity,
        'ownershipLeaseId': ownershipLeaseId,
        'ownershipGeneration': ownershipGeneration,
        'turnGeneration': turnGeneration,
        'dispatchGeneration': dispatchGeneration,
        'playbackGeneration': playbackGeneration,
        'occurredAt': occurredAt.toUtc().toIso8601String(),
        if (failureCode != null) 'failureCode': failureCode,
      };
}

AgentDeliveryRoomEvent? parseAgentDeliveryRoomEvent(
  List<int> bytes, {
  required String expectedSessionId,
  required String expectedClientParticipantIdentity,
}) {
  if (bytes.length < 2 || bytes.length > 8192) return null;
  try {
    final decoded = jsonDecode(utf8.decode(bytes));
    if (decoded is! Map<String, Object?> || decoded['version'] != 1) return null;
    final type = _text(decoded, 'type');
    final failureCode = decoded['failureCode'];
    if (!_lifecycleTypes.contains(type) ||
        (type == 'agent.delivery.failed') != (failureCode is String)) {
      return null;
    }
    final sessionId = _text(decoded, 'sessionId');
    final clientIdentity = _text(
      decoded,
      'clientParticipantIdentity',
      maximum: 320,
    );
    final workerIdentity = _text(
      decoded,
      'workerParticipantIdentity',
      maximum: 320,
    );
    if (sessionId != expectedSessionId ||
        clientIdentity != expectedClientParticipantIdentity ||
        !workerIdentity.startsWith('$expectedSessionId:worker:')) {
      return null;
    }
    return AgentDeliveryRoomEvent(
      eventId: _text(decoded, 'eventId', maximum: 200),
      type: type,
      deliveryAttemptId: _text(decoded, 'deliveryAttemptId'),
      workId: _text(decoded, 'workId'),
      sessionId: sessionId,
      legId: _text(decoded, 'legId'),
      turnId: _text(decoded, 'turnId'),
      turnGeneration: _integer(decoded, 'turnGeneration'),
      dispatchGeneration: _integer(decoded, 'dispatchGeneration'),
      clientInstanceId: _text(decoded, 'clientInstanceId'),
      clientParticipantIdentity: clientIdentity,
      workerParticipantIdentity: workerIdentity,
      ownershipLeaseId: _text(decoded, 'ownershipLeaseId'),
      ownershipGeneration: _integer(decoded, 'ownershipGeneration'),
      playbackId: _text(decoded, 'playbackId'),
      playbackGeneration: _integer(decoded, 'playbackGeneration'),
      occurredAt: _time(decoded, 'occurredAt'),
      failureCode: failureCode is String
          ? _bounded(failureCode, maximum: 120)
          : null,
    );
  } catch (_) {
    return null;
  }
}

String _text(
  Map<String, Object?> value,
  String key, {
  int maximum = 160,
}) => _bounded(value[key], maximum: maximum);

String _bounded(Object? value, {required int maximum}) {
  if (value is! String || value.trim().isEmpty ||
      utf8.encode(value).length > maximum) {
    throw const FormatException('Invalid Agent delivery event');
  }
  return value.trim();
}

int _integer(Map<String, Object?> value, String key) {
  final input = value[key];
  if (input is! num || input.toInt() < 1 || input.toInt() != input) {
    throw const FormatException('Invalid Agent delivery generation');
  }
  return input.toInt();
}

DateTime _time(Map<String, Object?> value, String key) {
  final parsed = DateTime.tryParse(_text(value, key));
  if (parsed == null) throw const FormatException('Invalid Agent delivery time');
  return parsed.toUtc();
}
