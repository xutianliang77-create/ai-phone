import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/call_link/data/call_link_api_client.dart';
import 'package:translation_mobile/src/features/call_link/data/call_room_client.dart';
import 'package:translation_mobile/src/features/pstn_call/presentation/widgets/pstn_call_widgets.dart';

void main() {
  testWidgets(
      'does not infer an Air780 connection from LiveKit participant presence',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: PstnActiveCallCard(
          call: SipOutboundCall(
            callId: 'call-1',
            sessionId: 'call-1',
            roomName: 'call_call-1',
            operationId: 'operation-1',
            provider: 'air780_volte',
            status: 'accepted',
            replayed: false,
          ),
          roomSnapshot: CallRoomSnapshot(
            status: CallRoomConnectionStatus.connected,
            microphoneEnabled: true,
            microphonePausedForPlayback: false,
            remoteParticipantCount: 2,
          ),
          busy: false,
          hangupPending: false,
          chinese: true,
          onEnd: _ignore,
          onDtmf: _ignoreDigit,
          onTransfer: _ignore,
          supportsDtmf: false,
          supportsTransfer: false,
        ),
      ),
    ));

    expect(find.text('正在与运营商确认电话状态'), findsOneWidget);
    expect(find.text('电话已接通'), findsNothing);
  });
}

void _ignore() {}

void _ignoreDigit(String _) {}
