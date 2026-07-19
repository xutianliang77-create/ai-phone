import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/voice_identity/data/voice_identity_api_client.dart';
import 'package:translation_mobile/src/features/voice_identity/presentation/pages/voice_identity_page.dart';
import 'package:translation_mobile/src/features/voice_profile/data/voice_reference_recorder.dart';

void main() {
  testWidgets('recovers controls after the initial identity load times out',
      (tester) async {
    final client = _TimeoutThenReadyClient();
    await tester.pumpWidget(MaterialApp(
      locale: const Locale('zh'),
      localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: VoiceIdentityPage(client: client),
    ));
    await tester.pumpAndSettle();

    expect(find.text('连接服务器超时，请确认 Tailscale 已连接后重试'), findsOneWidget);
    expect(find.text('重试'), findsOneWidget);

    await tester.enterText(find.byType(TextField), '测试说话人');
    await tester.tap(find.byType(Checkbox));
    await tester.tap(find.text('新建声音身份'));
    await tester.pumpAndSettle();

    expect(client.createdName, '测试说话人');
    expect(find.text('身份已创建，请录制 5 至 15 秒清晰语音'), findsOneWidget);
  });

  testWidgets('deletes a pending identity without requiring enrollment',
      (tester) async {
    final client = _ReadyClient();
    await tester.pumpWidget(_app(
      VoiceIdentityPage(client: client, recorder: _FakeRecorder()),
    ));
    await tester.pumpAndSettle();

    expect(find.text('待录入'), findsOneWidget);
    await tester.tap(find.byTooltip('删除'));
    await tester.pumpAndSettle();

    expect(client.deletedId, 'identity-1');
    expect(find.text('声音身份已删除'), findsOneWidget);
    expect(find.text('待录入'), findsNothing);
  });

  testWidgets('rejects a short recording before uploading it', (tester) async {
    final client = _ReadyClient();
    final recorder = _FakeRecorder(durationMs: 2500);
    await tester.pumpWidget(_app(
      VoiceIdentityPage(client: client, recorder: recorder),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('录入声音'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('停止录音'));
    await tester.pumpAndSettle();

    expect(client.enrollCalls, 0);
    expect(find.text('录音时间太短，请自然说话 5 至 15 秒后再停止'), findsOneWidget);
    expect(find.byTooltip('录入声音'), findsOneWidget);
  });

  testWidgets('shows the quality reason returned with a 422 response',
      (tester) async {
    final client = _ReadyClient(
        enrollError: const VoiceIdentityApiException(
      422,
      {
        'error': {'code': 'voice_reference_too_quiet'},
        'quality': {
          'issues': ['voice_reference_too_quiet'],
        },
      },
    ));
    await tester.pumpWidget(_app(
      VoiceIdentityPage(client: client, recorder: _FakeRecorder()),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('录入声音'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('停止录音'));
    await tester.pumpAndSettle();

    expect(find.text('录音音量太低，请靠近麦克风并正常说话'), findsOneWidget);
    expect(find.byTooltip('录入声音'), findsOneWidget);
  });
}

Widget _app(Widget home) => MaterialApp(
      locale: const Locale('zh'),
      localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: home,
    );

class _TimeoutThenReadyClient implements VoiceIdentityClient {
  String? createdName;

  @override
  Future<List<VoiceIdentity>> list() => Future.error(TimeoutException('test'));

  @override
  Future<VoiceIdentity> create({
    required String displayName,
    required String consentVersion,
  }) async {
    createdName = displayName;
    return const VoiceIdentity(
      id: 'identity-1',
      displayName: '测试说话人',
      status: 'pending_enrollment',
      matchThreshold: 0.72,
    );
  }

  @override
  Future<VoiceIdentity> enroll({
    required String identityId,
    required String audioBase64,
  }) =>
      throw UnimplementedError();

  @override
  Future<VoiceIdentity> revoke(String identityId) => throw UnimplementedError();

  @override
  Future<VoiceIdentity> delete(String identityId) => throw UnimplementedError();
}

class _ReadyClient implements VoiceIdentityClient {
  _ReadyClient({this.enrollError});

  final Object? enrollError;
  int enrollCalls = 0;
  String? deletedId;

  @override
  Future<List<VoiceIdentity>> list() async => const [_pendingIdentity];

  @override
  Future<VoiceIdentity> create({
    required String displayName,
    required String consentVersion,
  }) =>
      throw UnimplementedError();

  @override
  Future<VoiceIdentity> enroll({
    required String identityId,
    required String audioBase64,
  }) async {
    enrollCalls += 1;
    if (enrollError != null) throw enrollError!;
    return const VoiceIdentity(
      id: 'identity-1',
      displayName: '徐先生',
      status: 'ready',
      matchThreshold: 0.72,
    );
  }

  @override
  Future<VoiceIdentity> revoke(String identityId) => throw UnimplementedError();

  @override
  Future<VoiceIdentity> delete(String identityId) async {
    deletedId = identityId;
    return const VoiceIdentity(
      id: 'identity-1',
      displayName: '徐先生',
      status: 'deleted',
      matchThreshold: 0.72,
    );
  }
}

class _FakeRecorder implements VoiceReferenceRecorder {
  _FakeRecorder({this.durationMs = 6000});

  final int durationMs;

  @override
  Future<void> start() async {}

  @override
  Future<VoiceReferenceRecording> stop() async => VoiceReferenceRecording(
        bytes: const [1, 2, 3],
        durationMs: durationMs,
      );

  @override
  Future<void> dispose() async {}
}

const _pendingIdentity = VoiceIdentity(
  id: 'identity-1',
  displayName: '徐先生',
  status: 'pending_enrollment',
  matchThreshold: 0.72,
);
