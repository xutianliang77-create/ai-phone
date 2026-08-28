import 'dart:async';

import 'package:translation_mobile/src/features/call_link/data/agent_delivery_room_event.dart';
import 'package:translation_mobile/src/features/call_link/data/call_link_api_client.dart';
import 'package:translation_mobile/src/features/call_link/data/call_room_client.dart';

class FakeCallRoomClient implements CallRoomClient {
  FakeCallRoomClient({
    this.message,
    this.captions = const <CallRoomCaption>[],
    this.microphoneEnabled = true,
    this.microphonePausedForPlayback = false,
  });

  final StreamController<CallRoomSnapshot> _snapshots =
      StreamController<CallRoomSnapshot>.broadcast();

  CallRoomToken? connectedToken;
  bool translationMediaOnly = false;
  bool airTakeoverUplink = false;
  bool activeMicrophoneEnabled = false;
  final String? message;
  final List<CallRoomCaption> captions;
  final bool microphoneEnabled;
  final bool microphonePausedForPlayback;

  @override
  Stream<CallRoomSnapshot> get snapshots => _snapshots.stream;

  @override
  Stream<AgentDeliveryRoomEvent> get deliveryEvents =>
      const Stream<AgentDeliveryRoomEvent>.empty();

  @override
  Future<void> connect(
    CallRoomToken token, {
    bool enableMicrophone = true,
    bool translationMediaOnly = false,
    bool airTakeoverUplink = false,
  }) async {
    connectedToken = token;
    this.translationMediaOnly = translationMediaOnly;
    this.airTakeoverUplink = airTakeoverUplink;
    activeMicrophoneEnabled = enableMicrophone && microphoneEnabled;
    _emitConnected();
  }

  @override
  Future<void> setMicrophoneEnabled(bool enabled) async {
    activeMicrophoneEnabled = enabled && microphoneEnabled;
    _emitConnected();
  }

  @override
  Future<bool> waitForRemoteAudioPlayoutEvidence(
    String participantIdentity, {
    required Duration timeout,
  }) async => false;

  void _emitConnected() {
    _snapshots.add(CallRoomSnapshot(
      status: CallRoomConnectionStatus.connected,
      microphoneEnabled: activeMicrophoneEnabled,
      microphonePausedForPlayback: microphonePausedForPlayback,
      remoteParticipantCount: 1,
      message: message,
      captions: captions,
    ));
  }

  @override
  Future<void> disconnect() async {
    _snapshots.add(const CallRoomSnapshot.disconnected());
  }

  @override
  Future<void> dispose() async {
    await _snapshots.close();
  }
}
