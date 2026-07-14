import 'dart:async';

import 'package:translation_mobile/src/features/account/data/account_auth_headers.dart';
import 'package:translation_mobile/src/features/call_link/data/call_link_api_client.dart';
import 'package:translation_mobile/src/features/call_link/data/call_room_client.dart';

class FakeCallLinkApiClient extends CallLinkApiClient {
  FakeCallLinkApiClient({
    this.tokenFails = false,
    this.authRequired = false,
    this.activeGuestCountAfterFetch = 0,
  }) : super(baseUrl: Uri.parse('http://localhost'));

  final bool tokenFails;
  final bool authRequired;
  final int activeGuestCountAfterFetch;
  int createCount = 0;
  int tokenCreateCount = 0;
  int connectionConfirmCount = 0;
  final List<String> fetchedCallIds = <String>[];
  final List<String> endedCallIds = <String>[];

  @override
  Future<CallLink> createCallLink() async {
    createCount += 1;
    if (authRequired) throw const AccountAuthRequiredException();
    return CallLink(
      callId: 'call_1',
      sessionId: 'call_1',
      roomName: 'call_call_1',
      roomProvider: 'livekit',
      joinUrl: 'https://call.example.cn/join/call_1',
      hostUrl: 'https://call.example.cn/host/call_1',
      status: 'created',
      expiresAt: DateTime.utc(2026, 7, 2, 12),
    );
  }

  @override
  Future<CallLink> getCallLink({required String callId}) async {
    fetchedCallIds.add(callId);
    return CallLink(
      callId: callId,
      sessionId: callId,
      roomName: 'call_$callId',
      roomProvider: 'livekit',
      joinUrl: 'https://call.example.cn/join/$callId',
      hostUrl: 'https://call.example.cn/host/$callId',
      status: 'created',
      expiresAt: DateTime.utc(2026, 7, 2, 12),
      activeGuestCount: activeGuestCountAfterFetch,
    );
  }

  @override
  Future<CallRoomToken> createRoomToken({
    required String callId,
    String participantRole = 'host',
    String? participantName,
  }) async {
    tokenCreateCount += 1;
    if (tokenFails) {
      throw const CallLinkApiException('Create room token failed: 503');
    }
    return CallRoomToken(
      callId: callId,
      provider: 'livekit',
      roomName: 'call_$callId',
      wsUrl: 'wss://livekit.example.cn',
      participantIdentity: '$callId:$participantRole:test',
      participantRole: participantRole,
      token: 'secret-room-token',
      expiresAt: DateTime.utc(2026, 7, 2, 13),
    );
  }

  @override
  Future<void> confirmRoomConnected(CallRoomToken token) async {
    connectionConfirmCount += 1;
  }

  @override
  Future<CallLinkEndResult> endCallLink({required String callId}) async {
    endedCallIds.add(callId);
    return CallLinkEndResult(
      callId: callId,
      sessionId: callId,
      status: 'ended',
      consumedSeconds: 8,
      endedAt: DateTime.utc(2026, 7, 2, 13),
    );
  }

  @override
  void close() {}
}

class FakeCallRoomClient implements CallRoomClient {
  FakeCallRoomClient({
    this.message,
    this.captions = const <CallRoomCaption>[],
  });

  final StreamController<CallRoomSnapshot> _snapshots =
      StreamController<CallRoomSnapshot>.broadcast();

  CallRoomToken? connectedToken;
  final String? message;
  final List<CallRoomCaption> captions;

  @override
  Stream<CallRoomSnapshot> get snapshots => _snapshots.stream;

  @override
  Future<void> connect(CallRoomToken token) async {
    connectedToken = token;
    _snapshots.add(CallRoomSnapshot(
      status: CallRoomConnectionStatus.connected,
      microphoneEnabled: true,
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
