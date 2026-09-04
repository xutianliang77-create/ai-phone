import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/call_link/data/call_link_api_client.dart';
import 'package:translation_mobile/src/features/call_link/data/call_room_client.dart';
import 'package:translation_mobile/src/features/pstn_call/data/pstn_call_session.dart';
import 'package:translation_mobile/src/features/pstn_call/presentation/widgets/pstn_call_control_panel.dart';

import 'support/fake_call_link_test_clients.dart';

void main() {
  testWidgets('does not promote SIP to connected from LiveKit presence',
      (tester) async {
    final session = PstnCallSession(
      apiClient: FakeCallLinkApiClient(),
      roomClient: FakeCallRoomClient(),
    );
    const room = CallRoomSnapshot(
      status: CallRoomConnectionStatus.connected,
      microphoneEnabled: true,
      remoteParticipantCount: 2,
    );

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: ListView(children: <Widget>[
          PstnCallControlPanel(
            session: session,
            call: call(status: 'accepted'),
            roomSnapshot: room,
            endBusy: false,
            hangupPending: false,
            chinese: true,
            onEnd: () {},
            defaultCountry: 'CN',
          ),
        ]),
      ),
    ));

    expect(find.text('正在等待对方接听'), findsOneWidget);
    expect(find.text('电话已接通'), findsNothing);
    final typeToSpeak = tester.widget<FilledButton>(
      find.byKey(const Key('pstn-type-to-speak')),
    );
    expect(typeToSpeak.onPressed, isNull);

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: ListView(children: <Widget>[
          PstnCallControlPanel(
            session: session,
            call: call(status: 'active'),
            roomSnapshot: room,
            endBusy: false,
            hangupPending: false,
            chinese: true,
            onEnd: () {},
            defaultCountry: 'CN',
          ),
        ]),
      ),
    ));
    expect(find.text('电话已接通'), findsOneWidget);
    expect(
      tester.widget<FilledButton>(
        find.byKey(const Key('pstn-type-to-speak')),
      ).onPressed,
      isNotNull,
    );

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: ListView(children: <Widget>[
          PstnCallControlPanel(
            session: session,
            call: call(status: 'active'),
            roomSnapshot: room,
            endBusy: false,
            hangupPending: true,
            chinese: true,
            onEnd: () {},
            defaultCountry: 'CN',
          ),
        ]),
      ),
    ));
    expect(
      tester.widget<FilledButton>(
        find.byKey(const Key('pstn-type-to-speak')),
      ).onPressed,
      isNull,
    );
  });
}

SipOutboundCall call({required String status}) => SipOutboundCall(
      callId: 'call-1',
      sessionId: 'call-1',
      roomName: 'call_call-1',
      operationId: 'sip-operation-1',
      provider: 'livekit_sip',
      status: status,
      replayed: false,
    );
