import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/ai_calling_agent/data/agent_delivery_receipt_outbox.dart';
import 'package:translation_mobile/src/features/ai_calling_agent/data/agent_voice_control_api.dart';
import 'package:translation_mobile/src/features/ai_calling_agent/data/agent_voice_control_controller.dart';
import 'package:translation_mobile/src/features/ai_calling_agent/data/ai_calling_agent_api_client.dart';
import 'package:translation_mobile/src/features/ai_calling_agent/data/voice_client_instance_store.dart';
import 'package:translation_mobile/src/features/call_link/data/agent_delivery_room_event.dart';
import 'package:translation_mobile/src/features/call_link/data/call_link_api_client.dart';
import 'package:translation_mobile/src/features/call_link/data/call_room_client.dart';

void main() {
  test('receipts start and end only after exact Worker media progress',
      () async {
    final room = _Room();
    final voiceApi = _VoiceApi();
    final controller = _createController(room, voiceApi);
    await controller.start(
      draftId: 'draft-1',
      participantIdentity: hostIdentity,
    );
    room.snapshot(<String>{workerIdentity});
    room.event(delivery('event-1', 'agent.delivery.queued'));
    room.event(delivery('event-2', 'agent.delivery.started'));
    await until(() => voiceApi.receipts.length == 1);
    room.event(delivery('event-3', 'agent.delivery.ended'));
    await until(() => voiceApi.receipts.length == 2);

    expect(voiceApi.receipts.map((item) => item['type']), [
      'client.playback.started',
      'client.playback.ended',
    ]);
    expect(
        voiceApi.receipts.every(
          (item) => item['workerParticipantIdentity'] == workerIdentity,
        ),
        isTrue);
    await controller.dispose();
  });

  test('fails closed without bound Worker playout evidence', () async {
    final room = _Room();
    final voiceApi = _VoiceApi();
    final controller = _createController(room, voiceApi);
    await controller.start(
      draftId: 'draft-1',
      participantIdentity: hostIdentity,
    );
    room.snapshot(const <String>{});
    room.event(delivery('event-1', 'agent.delivery.queued'));
    room.event(delivery('event-2', 'agent.delivery.started'));
    await until(() => voiceApi.receipts.isNotEmpty);

    expect(
        voiceApi.receipts.single,
        containsPair(
          'failureCode',
          'bound_worker_playout_evidence_unavailable',
        ));
    await controller.dispose();
  });

  test('reuses takeover identities after an unknown request result', () async {
    final room = _Room();
    final voiceApi = _VoiceApi()
      ..ownership = VoiceClientOwnership(
        sessionId: 'session-1',
        legId: 'leg-host',
        accountId: 'account-1',
        clientInstanceId: 'vci_other_client_01234567890123456789',
        participantIdentity: 'session-1:host:other-user',
        generation: 6,
        leaseId: 'voice-lease-other',
        leaseExpiresAt: DateTime.now().toUtc().add(const Duration(minutes: 5)),
        state: 'active',
        version: 1,
        updatedAt: DateTime.now().toUtc(),
      )
      ..failFirstTakeoverRequest = true;
    final controller = _createController(room, voiceApi);
    await controller.start(
      draftId: 'draft-1',
      participantIdentity: hostIdentity,
    );

    await expectLater(
        controller.takeOverOwnership(), throwsA(isA<TimeoutException>()));
    await controller.takeOverOwnership();

    expect(voiceApi.takeoverIds, hasLength(2));
    expect(voiceApi.takeoverIds.toSet(), hasLength(1));
    expect(voiceApi.takeoverRequestCommandIds.toSet(), hasLength(1));
    await controller.dispose();
  });
}

const hostIdentity = 'session-1:host:user-1';
const workerIdentity = 'session-1:worker:voice_agent_001_g4';
const clientInstanceId = 'vci_0123456789abcdefghijklmnopqrstuv';

AgentVoiceControlController _createController(_Room room, _VoiceApi voiceApi) =>
    AgentVoiceControlController(
      api: AiCallingAgentApiClient(baseUrl: Uri.parse('http://localhost')),
      voiceApi: voiceApi,
      room: room,
      instanceStore: MemoryVoiceClientInstanceStore(clientInstanceId),
      receiptOutbox: MemoryAgentDeliveryReceiptOutbox(),
      workerAudioEvidenceTimeout: const Duration(milliseconds: 5),
    );

AgentDeliveryRoomEvent delivery(String eventId, String type) =>
    AgentDeliveryRoomEvent(
      eventId: eventId,
      type: type,
      deliveryAttemptId: 'delivery-1',
      workId: 'work-1',
      sessionId: 'session-1',
      legId: 'leg-host',
      turnId: 'turn-7',
      turnGeneration: 4,
      dispatchGeneration: 4,
      clientInstanceId: clientInstanceId,
      clientParticipantIdentity: hostIdentity,
      workerParticipantIdentity: workerIdentity,
      ownershipLeaseId: 'voice-lease-1',
      ownershipGeneration: 6,
      playbackId: 'playback-1',
      playbackGeneration: 11,
      occurredAt: DateTime.utc(2026, 7, 30, 8),
    );

Future<void> until(bool Function() condition) async {
  for (var attempt = 0; attempt < 100 && !condition(); attempt += 1) {
    await Future<void>.delayed(const Duration(milliseconds: 2));
  }
  expect(condition(), isTrue);
}

class _Room implements CallRoomClient {
  final _snapshots = StreamController<CallRoomSnapshot>.broadcast();
  final _events = StreamController<AgentDeliveryRoomEvent>.broadcast();
  Set<String> _playoutEvidence = const <String>{};

  @override
  Stream<CallRoomSnapshot> get snapshots => _snapshots.stream;

  @override
  Stream<AgentDeliveryRoomEvent> get deliveryEvents => _events.stream;

  void snapshot(Set<String> audible) {
    _playoutEvidence = audible;
    _snapshots.add(CallRoomSnapshot(
        status: CallRoomConnectionStatus.connected,
        microphoneEnabled: true,
        remoteParticipantCount: 1,
        audibleRemoteAudioParticipantIdentities: audible,
      ));
  }

  void event(AgentDeliveryRoomEvent value) => _events.add(value);

  @override
  Future<void> connect(
    CallRoomToken token, {
    bool enableMicrophone = true,
    bool translationMediaOnly = false,
    bool airTakeoverUplink = false,
  }) async {}

  @override
  Future<void> disconnect() async {}

  @override
  Future<void> setMicrophoneEnabled(bool enabled) async {}

  @override
  Future<bool> waitForRemoteAudioPlayoutEvidence(
    String participantIdentity, {
    required Duration timeout,
  }) async => _playoutEvidence.contains(participantIdentity);

  @override
  Future<void> dispose() async {
    await _snapshots.close();
    await _events.close();
  }
}

class _VoiceApi implements AgentVoiceControlApi {
  final receipts = <Map<String, Object?>>[];
  final takeoverIds = <String>[];
  final takeoverRequestCommandIds = <String>[];
  bool failFirstTakeoverRequest = false;
  late VoiceClientOwnership ownership = VoiceClientOwnership(
    sessionId: 'session-1',
    legId: 'leg-host',
    accountId: 'account-1',
    clientInstanceId: clientInstanceId,
    participantIdentity: hostIdentity,
    generation: 6,
    leaseId: 'voice-lease-1',
    leaseExpiresAt: DateTime.now().toUtc().add(const Duration(minutes: 5)),
    state: 'active',
    version: 1,
    updatedAt: DateTime.now().toUtc(),
  );

  @override
  Future<VoiceClientOwnership?> getVoiceOwnership(
          {required String draftId}) async =>
      ownership;

  @override
  Future<VoiceClientOwnership> acquireVoiceOwnership({
    required String draftId,
    required String commandId,
    required String clientInstanceId,
    required String participantIdentity,
    int leaseSeconds = 60,
  }) async =>
      ownership;

  @override
  Future<VoiceClientOwnership> renewVoiceOwnership({
    required String draftId,
    required String commandId,
    required String clientInstanceId,
    required String participantIdentity,
    required VoiceClientOwnership ownership,
    int leaseSeconds = 60,
  }) async =>
      ownership;

  @override
  Future<void> releaseVoiceOwnership({
    required String draftId,
    required String commandId,
    required String clientInstanceId,
    required String participantIdentity,
    required VoiceClientOwnership ownership,
    required String reason,
  }) async {}

  @override
  Future<List<AgentWorkPermissionRequest>> listPendingWorkPermissions({
    required String draftId,
  }) async =>
      const <AgentWorkPermissionRequest>[];

  @override
  Future<void> sendAgentDeliveryReceipt({
    required String draftId,
    required String deliveryAttemptId,
    required Map<String, Object?> receipt,
  }) async =>
      receipts.add(receipt);

  @override
  Future<VoiceClientTakeover> requestVoiceOwnershipTakeover({
    required String draftId,
    required String commandId,
    required String takeoverId,
    required String clientInstanceId,
    required String participantIdentity,
    required int expectedGeneration,
  }) async {
    takeoverIds.add(takeoverId);
    takeoverRequestCommandIds.add(commandId);
    if (failFirstTakeoverRequest) {
      failFirstTakeoverRequest = false;
      throw TimeoutException('unknown takeover request result');
    }
    return VoiceClientTakeover(
      takeoverId: takeoverId,
      expectedGeneration: expectedGeneration,
      status: 'pending',
      expiresAt: DateTime.now().toUtc().add(const Duration(seconds: 15)),
    );
  }

  @override
  Future<VoiceClientOwnership> confirmVoiceOwnershipTakeover({
    required String draftId,
    required String commandId,
    required VoiceClientTakeover takeover,
    required String clientInstanceId,
    required String participantIdentity,
    int leaseSeconds = 60,
  }) async {
    ownership = VoiceClientOwnership(
      sessionId: ownership.sessionId,
      legId: ownership.legId,
      accountId: ownership.accountId,
      clientInstanceId: clientInstanceId,
      participantIdentity: participantIdentity,
      generation: takeover.expectedGeneration + 1,
      leaseId: 'voice-lease-takeover',
      leaseExpiresAt: DateTime.now().toUtc().add(const Duration(seconds: 60)),
      state: 'active',
      version: ownership.version + 1,
      updatedAt: DateTime.now().toUtc(),
    );
    return ownership;
  }

  @override
  Future<AgentWorkPermissionRequest> resolveWorkPermission({
    required String draftId,
    required AgentWorkPermissionRequest permission,
    required String decision,
    required String commandId,
    required String clientInstanceId,
    required String participantIdentity,
    required VoiceClientOwnership ownership,
  }) =>
      throw UnimplementedError();
}
