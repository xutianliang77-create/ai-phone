import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/features/shell/presentation/pages/main_shell_page.dart';
import 'package:translation_mobile/src/platform/asr/apple_speech_prerecorded_input.dart';

import '../integration_test/support/prerecorded_app_fixture.dart';
import '../integration_test/support/prerecorded_test_scope.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const asr = MethodChannel('translation_mobile/apple_speech_asr');
  const mt = MethodChannel('translation_mobile/on_device_translation');
  const events = 'translation_mobile/apple_speech_asr/events';
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  testWidgets(
      'original UI resource failure retains the exact blocked preflight without inference',
      (tester) async {
    final support = (await tester.runAsync(
        () => Directory.systemTemp.createTemp('wujie-s2-resource-failure-')))!;
    final scope = (await tester.runAsync(
        () => PrerecordedTestScope.create(supportDirectory: support)))!;
    final fixture = PrerecordedAppFixture(
        input: AppleSpeechPrerecordedInput(
            wavBytes: Uint8List(44), sha256: 'a' * 64));
    final calls = <String>[];
    const snapshot = {
      'requestedLanguage': 'zh',
      'resolvedLocale': 'zh-CN',
      'assetStatus': 'supported',
      'installedLocales': ['zh-CN'],
      'reservedLocales': <String>[],
      'stage': 'availability'
    };
    messenger.setMockMethodCallHandler(asr, (call) async {
      calls.add(call.method);
      return call.method == 'isAvailable'
          ? {
              'canStart': false,
              'reason': 'language_resource_not_ready',
              'resourceSnapshot': snapshot,
              'locale': 'zh-CN',
            }
          : null;
    });
    messenger.setMockMethodCallHandler(
        mt,
        (_) async =>
            throw StateError('Resource-blocked ASR must not reach MT'));
    messenger.setMockMethodCallHandler(
        const MethodChannel(events), (_) async => null);
    try {
      await tester.pumpWidget(fixture.app);
      await _until(
          tester, () => find.byType(MainShellPage).evaluate().isNotEmpty);
      await tester.tap(find.byKey(const ValueKey('realtime-primary-action')));
      await _until(
          tester, () => fixture.controller.status == RealtimeStatus.failed);
      final report = fixture.asrAvailabilityReports.single;
      expect(report['canStart'], false);
      expect((report['details'] as Map)['resourceSnapshot'], snapshot);
      expect(calls.where((m) => m == 'isAvailable'), hasLength(1));
      expect(calls.where(['prepare', 'start', 'requestPermission'].contains),
          isEmpty);
      expect(fixture.inputObservations, isEmpty);
      expect(fixture.capture.startCalls, 0);
      expect(scope.blockedNetworkAttempts, 0);
      expect((await tester.runAsync(fixture.store.listSessions))!, isEmpty);
    } finally {
      await _complete(tester, fixture.stop());
      await tester.pumpWidget(const SizedBox.shrink());
      await _complete(tester, fixture.drainAndClose());
      scope.close();
      messenger.setMockMethodCallHandler(asr, null);
      messenger.setMockMethodCallHandler(mt, null);
      messenger.setMockMethodCallHandler(const MethodChannel(events), null);
    }
  });

  for (final observeOnly in [false, true]) {
    testWidgets(
        'original five-tab app: prerecorded start, subtitles, end and isolated history; observeOnly=$observeOnly',
        (tester) async {
      final support = (await tester.runAsync(
          () => Directory.systemTemp.createTemp('wujie-s2-ui-test-')))!;
      final sentinel = File('${support.path}/translation-local-sessions.json');
      await tester.runAsync(() => sentinel.writeAsString('original history'));
      final scope = (await tester.runAsync(
          () => PrerecordedTestScope.create(supportDirectory: support)))!;
      final fixture = PrerecordedAppFixture(
          observeOnly: observeOnly,
          input: AppleSpeechPrerecordedInput(
              wavBytes: Uint8List(44), sha256: 'a' * 64));
      Map<Object?, Object?>? start;
      final mtInputs = <String>[];
      messenger.setMockMethodCallHandler(asr, (call) async {
        final args = call.arguments as Map?;
        if (call.method == 'start') start = Map<Object?, Object?>.from(args!);
        return call.method == 'isAvailable'
            ? {
                'canStart': true,
                'locale': args!['language'],
                'reason': 'ready',
                'inputKind': 'prerecorded',
                'configurationFingerprint': 'a' * 64,
                'effectiveParameters': {
                  ...args,
                  'sampleRate': 16000,
                  'vadFrameSamples': 4096
                }
              }
            : null;
      });
      messenger.setMockMethodCallHandler(
          const MethodChannel(events), (_) async => null);
      messenger.setMockMethodCallHandler(mt, (call) async {
        expect(observeOnly, false,
            reason: 'ASR observation must not invoke MT');
        final args = call.arguments as Map;
        expect(args['sourceLanguage'], 'zh');
        expect(args['targetLanguage'], 'en');
        if (call.method == 'translate') mtInputs.add(args['text'] as String);
        return {
          'available': true,
          'status': 'installed',
          'sourceLanguage': 'zh-CN',
          'targetLanguage': 'en-US',
          'provider': 'ios_system',
          'text': 'A product meeting at three.'
        };
      });
      try {
        await tester.pumpWidget(fixture.app);
        await _until(
            tester, () => find.byType(MainShellPage).evaluate().isNotEmpty);
        expect(find.byType(NavigationDestination), findsNWidgets(5));
        expect(find.text('停止验证'), findsNothing);
        await tester.tap(find.byKey(const ValueKey('realtime-primary-action')));
        await _until(
            tester, () => fixture.controller.status == RealtimeStatus.active,
            diagnostic: () => fixture.controller.message);
        expect(start?['inputKind'], 'prerecorded');
        final identity = {
          'captureId': start!['captureId'],
          'languagePolicyKey': start!['languagePolicyKey']
        };
        for (final event in [
          {
            ...identity,
            'type': 'segment',
            'id': 'synthetic:0',
            'revision': 1,
            'text': '今天下午三点开产品会议。',
            'language': 'zh',
            'languageEvidence': 'user_selected',
            'isFinal': true
          },
          {
            ...identity,
            'type': 'input.completed',
            'sha256': 'a' * 64,
            'samples': 10
          }
        ]) {
          await messenger.handlePlatformMessage(events,
              const StandardMethodCodec().encodeSuccessEnvelope(event), (_) {});
        }
        await _until(
            tester,
            () => fixture.controller.segments.any((s) => observeOnly
                ? s.sourceText.isNotEmpty
                : s.translatedText.isNotEmpty));
        expect(find.textContaining('今天下午三点开产品会议。', findRichText: true),
            findsWidgets);
        expect(
            find.textContaining('A product meeting at three.',
                findRichText: true),
            observeOnly ? findsNothing : findsWidgets);
        expect(mtInputs, observeOnly ? <String>[] : ['今天下午三点开产品会议。']);
        expect(fixture.inputCompletions, hasLength(1));
        await tester
            .tap(find.byKey(const ValueKey('realtime-secondary-action')));
        await _until(
            tester, () => fixture.controller.status == RealtimeStatus.ended,
            diagnostic: () => fixture.controller.message);
        await _complete(tester, fixture.store.waitForWrites());
        final saved = (await tester.runAsync(fixture.store.listSessions))!;
        expect(saved, hasLength(1));
        await _complete(
            tester, fixture.controller.stop()); // An idempotent repeated end.
        expect(
            (await tester.runAsync(fixture.store.listSessions))!, hasLength(1));
        expect(fixture.store.writeCount, 1);
        await tester.tap(find.byType(NavigationDestination).at(3));
        final record = find.widgetWithText(ListTile, saved.single.title!);
        await _until(tester, () => record.evaluate().isNotEmpty);
        await tester.tap(record);
        await _until(tester, () => find.text('会话详情').evaluate().isNotEmpty);
        if (!observeOnly) {
          await _until(
              tester,
              () => find
                  .textContaining('A product meeting at three.',
                      findRichText: true)
                  .evaluate()
                  .isNotEmpty);
        }
        expect(find.textContaining('今天下午三点开产品会议。', findRichText: true),
            findsWidgets);
        expect(scope.blockedNetworkAttempts, 0);
        expect(fixture.capture.startCalls, 0);
        expect(
            await tester.runAsync(sentinel.readAsString), 'original history');
        expect(tester.takeException(), isNull);
      } finally {
        await _complete(tester, fixture.stop());
        await tester.pumpWidget(const SizedBox.shrink());
        await _complete(tester, fixture.drainAndClose());
        scope.close();
        messenger.setMockMethodCallHandler(asr, null);
        messenger.setMockMethodCallHandler(mt, null);
        messenger.setMockMethodCallHandler(const MethodChannel(events), null);
      }
    });
  }
}

Future<void> _until(WidgetTester tester, bool Function() ready,
    {String? Function()? diagnostic}) async {
  for (var i = 0; i < 200; i++) {
    await tester
        .runAsync(() => Future<void>.delayed(const Duration(milliseconds: 10)));
    await tester.pump(const Duration(milliseconds: 50));
    if (ready()) return;
  }
  fail(
      'Original app did not reach expected state: ${diagnostic?.call() ?? "UI wait timed out"}');
}

Future<void> _complete(WidgetTester tester, Future<void> future) async {
  var done = false;
  Object? error;
  unawaited(future.then((_) {
    done = true;
  }, onError: (Object e) {
    error = e;
    done = true;
  }));
  await _until(tester, () => done);
  if (error != null) throw error!;
}
