import 'dart:async';
import 'package:livekit_client/livekit_client.dart' as livekit;
import 'agent_delivery_room_event.dart';
import 'agent_delivery_room_event_state.dart';
import 'call_link_api_client.dart';
import 'call_room_capture_options.dart';
import 'call_room_data_event.dart';
import 'call_room_client.dart';
import 'call_room_event_state.dart';
import 'call_room_participant_policy.dart';
import 'call_room_tts_capture_controller.dart';
import 'livekit_call_room_snapshot.dart';
import 'livekit_remote_audio_playout_evidence.dart';
import 'livekit_call_room_subscription_controller.dart';

part 'livekit_call_room_policy_sync.dart';
part 'livekit_call_room_events.dart';

class LiveKitCallRoomClient implements CallRoomClient {
  final StreamController<CallRoomSnapshot> _snapshots =
      StreamController<CallRoomSnapshot>.broadcast();
  final StreamController<AgentDeliveryRoomEvent> _deliveryEvents =
      StreamController<AgentDeliveryRoomEvent>.broadcast();
  livekit.Room? _room;
  livekit.EventsListener<livekit.RoomEvent>? _listener;
  final CallRoomTtsCaptureController _ttsCapture =
      CallRoomTtsCaptureController();
  CallRoomSnapshot _current = const CallRoomSnapshot.disconnected();
  bool _disposed = false;
  bool _fullDuplexEnabled = false;
  bool _duplexDegraded = false;
  final CallRoomEventState _eventState = CallRoomEventState();
  final AgentDeliveryRoomEventState _deliveryEventState =
      AgentDeliveryRoomEventState();
  LiveKitCallRoomSubscriptionController? _subscriptions;

  @override
  Stream<CallRoomSnapshot> get snapshots => _snapshots.stream;

  @override
  Stream<AgentDeliveryRoomEvent> get deliveryEvents => _deliveryEvents.stream;

  @override
  Future<void> connect(
    CallRoomToken token, {
    bool enableMicrophone = true,
    bool translationMediaOnly = false,
    bool airTakeoverUplink = false,
  }) async {
    if (_disposed) return;
    if (translationMediaOnly && airTakeoverUplink) {
      throw ArgumentError(
        'Translation isolation and Air takeover cannot be enabled together',
      );
    }
    if (airTakeoverUplink && token.participantRole != 'host') {
      throw ArgumentError('Only a bound Host can publish Air takeover audio');
    }
    await _disposeRoom(disconnectFirst: true);
    _fullDuplexEnabled = token.fullDuplexEnabled;
    _duplexDegraded = false;
    _eventState.reset();
    _deliveryEventState.reset();
    _subscriptions = LiveKitCallRoomSubscriptionController(
      callId: token.callId,
      localRole: token.participantRole,
      localParticipantIdentity: token.participantIdentity,
      translationMediaOnly: translationMediaOnly,
      airTakeoverUplink: airTakeoverUplink,
    );
    _emit(const CallRoomSnapshot(
      status: CallRoomConnectionStatus.connecting,
      microphoneEnabled: false,
      microphonePausedForPlayback: false,
      remoteParticipantCount: 0,
    ));

    final room = livekit.Room(
      roomOptions: const livekit.RoomOptions(
        adaptiveStream: false,
        dynacast: false,
        defaultAudioOutputOptions: livekit.AudioOutputOptions(speakerOn: true),
      ),
    );
    final listener = room.createListener();
    _room = room;
    _listener = listener;
    _listenToRoom(
      room,
      listener,
      callId: token.callId,
      roomName: token.roomName,
      localRole: token.participantRole,
    );

    try {
      await room.prepareConnection(token.wsUrl, token.token);
      await room.connect(
        token.wsUrl,
        token.token,
        connectOptions: const livekit.ConnectOptions(autoSubscribe: false),
      );
      _subscriptions!.syncLocalTrackPermissions(room);
      await room.localParticipant?.setMicrophoneEnabled(
        enableMicrophone,
        audioCaptureOptions:
            enableMicrophone ? callRoomAudioCaptureOptions : null,
      );
      await _subscriptions!.syncRemoteAudioSubscriptions(room);
      _emit(_current.fromLiveKitRoom(
        room,
        status: CallRoomConnectionStatus.connected,
        microphoneEnabled: enableMicrophone,
      ));
    } catch (error) {
      await _disposeRoom(disconnectFirst: true);
      _emit(CallRoomSnapshot.disconnected(
        message: 'Connect call room failed: $error',
      ));
      rethrow;
    }
  }

  @override
  Future<void> setMicrophoneEnabled(bool enabled) async {
    final room = _room;
    final participant = room?.localParticipant;
    if (room == null ||
        participant == null ||
        room.connectionState != livekit.ConnectionState.connected) {
      throw StateError('Call room is not connected');
    }
    await participant.setMicrophoneEnabled(
      enabled,
      audioCaptureOptions: enabled ? callRoomAudioCaptureOptions : null,
    );
    _emit(_current.fromLiveKitRoom(room, microphoneEnabled: enabled));
  }

  @override
  Future<bool> waitForRemoteAudioPlayoutEvidence(
    String participantIdentity, {
    required Duration timeout,
  }) async {
    final room = _room;
    if (room == null || participantIdentity.trim().isEmpty) return false;
    final observed = await waitForLiveKitRemoteAudioPlayoutEvidence(
      room: room,
      participantIdentity: participantIdentity,
      timeout: timeout,
    );
    return observed && identical(_room, room) && !_disposed;
  }

  @override
  Future<void> disconnect() async {
    await _disposeRoom(disconnectFirst: true);
    _emit(const CallRoomSnapshot.disconnected());
  }

  @override
  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    await _disposeRoom(disconnectFirst: true);
    await _snapshots.close();
    await _deliveryEvents.close();
  }

  Future<void> _disposeRoom({required bool disconnectFirst}) async {
    _ttsCapture.reset();
    final listener = _listener;
    final room = _room;
    _listener = null;
    _room = null;
    _fullDuplexEnabled = false;
    _duplexDegraded = false;
    _eventState.reset();
    _deliveryEventState.reset();
    _subscriptions = null;
    if (listener != null) {
      await _ignoreErrors(listener.dispose);
    }
    if (room != null) {
      if (disconnectFirst) {
        await _ignoreErrors(room.disconnect);
      }
      await _ignoreErrors(room.dispose);
    }
  }

  Future<void> _ignoreErrors(Future<dynamic> Function() action) async {
    try {
      await action();
    } catch (_) {}
  }

  void _emit(CallRoomSnapshot snapshot) {
    _current = snapshot;
    if (!_disposed && !_snapshots.isClosed) {
      _snapshots.add(snapshot);
    }
  }
}
