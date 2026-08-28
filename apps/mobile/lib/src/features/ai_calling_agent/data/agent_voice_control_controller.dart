import 'dart:async';

import '../../call_link/data/agent_delivery_room_event.dart';
import '../../call_link/data/call_room_client.dart';
import 'agent_delivery_receipt_outbox.dart';
import 'agent_voice_control_api.dart';
import 'ai_calling_agent_api_client.dart';
import 'voice_client_control_id.dart';
import 'voice_client_instance_store.dart';

part 'agent_voice_control_delivery.dart';
part 'agent_voice_control_ownership.dart';

class AgentVoiceControlSnapshot {
  const AgentVoiceControlSnapshot({
    this.ownership,
    this.permissions = const <AgentWorkPermissionRequest>[],
    this.ownedByAnotherClient = false,
    this.message,
    this.error,
  });

  final VoiceClientOwnership? ownership;
  final List<AgentWorkPermissionRequest> permissions;
  final bool ownedByAnotherClient;
  final String? message;
  final Object? error;
}

class AgentVoiceControlController {
  AgentVoiceControlController({
    required AiCallingAgentApiClient api,
    required this.room,
    AgentVoiceControlApi? voiceApi,
    VoiceClientInstanceStore? instanceStore,
    AgentDeliveryReceiptOutbox? receiptOutbox,
    this.workerAudioEvidenceTimeout = const Duration(seconds: 2),
  })  : api = voiceApi ?? AiCallingAgentVoiceControlApi(api),
        instanceStore = instanceStore ?? FileVoiceClientInstanceStore(),
        receiptOutbox = receiptOutbox ?? FileAgentDeliveryReceiptOutbox() {
    _roomSubscription = room.snapshots.listen((snapshot) {
      _roomSnapshot = snapshot;
    });
    _deliverySubscription = room.deliveryEvents.listen((event) {
      _deliveryTransition = _deliveryTransition
          .then((_) => _handleDelivery(event))
          .catchError((Object error) => _emit(error: error));
    });
  }

  final AgentVoiceControlApi api;
  final CallRoomClient room;
  final VoiceClientInstanceStore instanceStore;
  final AgentDeliveryReceiptOutbox receiptOutbox;
  final Duration workerAudioEvidenceTimeout;
  final StreamController<AgentVoiceControlSnapshot> _snapshots =
      StreamController<AgentVoiceControlSnapshot>.broadcast();
  Stream<AgentVoiceControlSnapshot> get snapshots => _snapshots.stream;

  StreamSubscription<CallRoomSnapshot>? _roomSubscription;
  StreamSubscription<AgentDeliveryRoomEvent>? _deliverySubscription;
  CallRoomSnapshot _roomSnapshot = const CallRoomSnapshot.disconnected();
  AgentVoiceControlSnapshot _current = const AgentVoiceControlSnapshot();
  Timer? _maintenanceTimer;
  Future<void> _transition = Future<void>.value();
  Future<void> _deliveryTransition = Future<void>.value();
  Future<void>? _draining;
  String? _draftId;
  String? _participantIdentity;
  String? _clientInstanceId;
  bool _disposed = false;
  final Map<String, bool> _playbackStarted = <String, bool>{};
  _VoiceTakeoverAttempt? _takeoverAttempt;

  Future<void> start({
    required String draftId,
    required String participantIdentity,
  }) =>
      _serialize(() async {
        if (_disposed) return;
        if (_draftId != null &&
            (_draftId != draftId ||
                _participantIdentity != participantIdentity)) {
          await _stopCurrent('client_disconnected');
        }
        _draftId = draftId;
        _participantIdentity = participantIdentity;
        _clientInstanceId ??= await instanceStore.loadOrCreate();
        await _synchronizeOwnership(allowSameClientRebind: true);
        await refreshPermissions();
        await drainReceipts();
        _maintenanceTimer ??= Timer.periodic(
          const Duration(seconds: 15),
          (_) => unawaited(_maintain()),
        );
      });

  Future<void> takeOverOwnership() => _serialize(() async {
        final ownership = _current.ownership;
        if (ownership == null) {
          await _synchronizeOwnership(allowSameClientRebind: true);
          return;
        }
        await _takeover(ownership);
        await refreshPermissions();
      });

  Future<void> resolvePermission(
    AgentWorkPermissionRequest permission,
    String decision,
  ) =>
      _serialize(() async {
        if (decision != 'grant' && decision != 'deny') {
          throw ArgumentError.value(decision, 'decision');
        }
        final context = _requireContext();
        final ownership = _current.ownership;
        if (ownership == null ||
            !ownership.controls(
              context.clientInstanceId,
              context.participantIdentity,
              DateTime.now().toUtc(),
            ) ||
            permission.sessionId != ownership.sessionId ||
            permission.legId != ownership.legId ||
            permission.status != 'pending' ||
            !permission.expiresAt.isAfter(DateTime.now().toUtc())) {
          throw StateError('Voice client ownership is stale');
        }
        await api.resolveWorkPermission(
          draftId: context.draftId,
          permission: permission,
          decision: decision,
          commandId: newVoiceClientControlId('permission'),
          clientInstanceId: context.clientInstanceId,
          participantIdentity: context.participantIdentity,
          ownership: ownership,
        );
        await refreshPermissions();
      });

  Future<void> refreshPermissions() async {
    final context = _context;
    final ownership = _current.ownership;
    if (context == null ||
        ownership == null ||
        !ownership.controls(
          context.clientInstanceId,
          context.participantIdentity,
          DateTime.now().toUtc(),
        )) {
      if (_current.permissions.isNotEmpty) {
        _emit(permissions: const <AgentWorkPermissionRequest>[]);
      }
      return;
    }
    try {
      final permissions = await api.listPendingWorkPermissions(
        draftId: context.draftId,
      );
      final now = DateTime.now().toUtc();
      _emit(
          permissions: permissions
              .where((item) =>
                  item.sessionId == ownership.sessionId &&
                  item.legId == ownership.legId &&
                  item.status == 'pending' &&
                  item.expiresAt.isAfter(now))
              .toList(growable: false));
    } catch (error) {
      _emit(error: error);
    }
  }

  Future<void> stop({String reason = 'client_disconnected'}) =>
      _serialize(() => _stopCurrent(reason));

  Future<void> dispose() async {
    if (_disposed) return;
    await stop();
    _disposed = true;
    _maintenanceTimer?.cancel();
    await _roomSubscription?.cancel();
    await _deliverySubscription?.cancel();
    await _deliveryTransition;
    await _snapshots.close();
  }

  Future<void> _maintain() => _serialize(() async {
        if (_context == null || _disposed) return;
        await _synchronizeOwnership(allowSameClientRebind: true);
        await refreshPermissions();
        await drainReceipts();
      });

  Future<void> _serialize(Future<void> Function() operation) {
    final next = _transition.then((_) => operation());
    _transition = next.catchError((Object error) => _emit(error: error));
    return next;
  }

  _VoiceControlContext? get _context {
    final draftId = _draftId;
    final participantIdentity = _participantIdentity;
    final clientInstanceId = _clientInstanceId;
    return draftId == null ||
            participantIdentity == null ||
            clientInstanceId == null
        ? null
        : _VoiceControlContext(
            draftId,
            participantIdentity,
            clientInstanceId,
          );
  }

  _VoiceControlContext _requireContext() {
    final value = _context;
    if (value == null) throw StateError('Voice control is not connected');
    return value;
  }

  void _emit({
    VoiceClientOwnership? ownership,
    bool clearOwnership = false,
    List<AgentWorkPermissionRequest>? permissions,
    bool? ownedByAnotherClient,
    String? message,
    Object? error,
  }) {
    _current = AgentVoiceControlSnapshot(
      ownership: clearOwnership ? null : ownership ?? _current.ownership,
      permissions: permissions ?? _current.permissions,
      ownedByAnotherClient:
          ownedByAnotherClient ?? _current.ownedByAnotherClient,
      message: message,
      error: error,
    );
    if (!_disposed && !_snapshots.isClosed) _snapshots.add(_current);
  }
}

class _VoiceControlContext {
  const _VoiceControlContext(
    this.draftId,
    this.participantIdentity,
    this.clientInstanceId,
  );

  final String draftId;
  final String participantIdentity;
  final String clientInstanceId;
}
