import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/call_link/data/call_room_client.dart';
import 'package:translation_mobile/src/shared/domain/speaker_attribution.dart';
import 'package:translation_mobile/src/features/call_link/presentation/pages/call_link_page.dart';
import 'package:translation_mobile/src/features/history/presentation/pages/session_detail_page.dart';

import 'domestic_release_screenshot_fakes.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('generates domestic release screenshots', (tester) async {
    final target = Platform.environment['SCREENSHOT_TARGET'];
    if (target == 'ios-main.png') {
      await _captureMain(tester, 'ios-main.png');
      return;
    }
    if (target == 'ios-call.png') {
      await _captureCall(tester, 'ios-call.png');
      return;
    }
    if (target == 'ios-history.png') {
      await _captureHistory(tester, 'ios-history.png');
      return;
    }
    if (target == 'android-main.png') {
      await _captureMain(tester, 'android-main.png');
      return;
    }
    if (target == 'android-call.png') {
      await _captureCall(tester, 'android-call.png');
      return;
    }
    if (target == 'android-history.png') {
      await _captureHistory(tester, 'android-history.png');
      return;
    }
    await _captureMain(tester, 'ios-main.png');
    await _captureCall(tester, 'ios-call.png');
    await _captureHistory(tester, 'ios-history.png');
    await _captureMain(tester, 'android-main.png');
    await _captureCall(tester, 'android-call.png');
    await _captureHistory(tester, 'android-history.png');
  });
}

Future<void> _captureMain(WidgetTester tester, String filename) {
  return _captureWidget(
    tester,
    filename,
    const ScreenshotApp(child: MainScreenshotPage()),
  );
}

Future<void> _captureCall(WidgetTester tester, String filename) async {
  final roomClient = FakeCallRoomClient(
    captions: const <CallRoomCaption>[
      CallRoomCaption(
        segmentId: 'segment-release',
        speaker: SpeakerAttribution(
          speakerId: 'guest',
          role: 'guest',
          source: 'participant_track',
        ),
        sourceLanguage: 'en',
        targetLanguage: 'zh',
        timestampMs: 1,
        sourceText: 'hello, this is a call room translation test',
        translatedText: '你好，这是一次通话房间翻译测试。',
        ttsReady: true,
        ttsProvider: 'qwen-tts',
      ),
    ],
  );
  await _pumpScreen(
    tester,
    ScreenshotApp(
      child: CallLinkPage(
        client: FakeCallLinkApiClient(),
        roomClient: roomClient,
        shareText: (_) async {},
      ),
    ),
  );
  await tester.tap(find.text('生成链接'));
  await _pumpFrames(tester);
  await tester.tap(find.text('进入房间'));
  await _pumpFrames(tester);
  await _writeScreenshot(filename);
  await _clearScreen(tester);
}

Future<void> _captureHistory(WidgetTester tester, String filename) {
  return _captureWidget(
    tester,
    filename,
    ScreenshotApp(
      child: SessionDetailPage(
        sessionId: 'release-session',
        repository: FakeSessionHistoryRepository(),
      ),
    ),
  );
}

Future<void> _captureWidget(
  WidgetTester tester,
  String filename,
  Widget child,
) async {
  await _pumpScreen(tester, child);
  await _writeScreenshot(filename);
  await _clearScreen(tester);
}

Future<void> _pumpScreen(WidgetTester tester, Widget child) async {
  await tester.binding.setSurfaceSize(_logicalSize);
  await tester.pumpWidget(RepaintBoundary(
    key: _captureKey,
    child: SizedBox.fromSize(size: _logicalSize, child: child),
  ));
  await _pumpFrames(tester);
}

Future<void> _pumpFrames(WidgetTester tester) async {
  for (var index = 0; index < 8; index += 1) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Future<void> _clearScreen(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox.shrink());
  await tester.pump(const Duration(milliseconds: 100));
  await tester.binding.setSurfaceSize(null);
}

Future<void> _writeScreenshot(String filename) async {
  stderr.writeln('Writing $filename');
  final output = File('../../release/domestic/screenshots/$filename');
  output.parent.createSync(recursive: true);
  await expectLater(
    find.byKey(_captureKey),
    matchesGoldenFile('../../../release/domestic/screenshots/$filename'),
  );
  stderr.writeln('Wrote ../../../release/domestic/screenshots/$filename');
}

const _logicalSize = Size(390, 844);
final _captureKey = GlobalKey();
