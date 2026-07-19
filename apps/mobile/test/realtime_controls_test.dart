import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_session_state.dart';
import 'package:translation_mobile/src/features/realtime/presentation/widgets/realtime_controls.dart';

void main() {
  test('maps every realtime status to executable actions only', () {
    expect(
      realtimeControlLayout(RealtimeStatus.idle),
      (primary: RealtimeControlAction.start, secondary: null, busy: false),
    );
    expect(
      realtimeControlLayout(RealtimeStatus.connecting),
      (primary: RealtimeControlAction.cancel, secondary: null, busy: false),
    );
    expect(
      realtimeControlLayout(RealtimeStatus.active),
      (
        primary: RealtimeControlAction.pause,
        secondary: RealtimeControlAction.end,
        busy: false,
      ),
    );
    expect(
      realtimeControlLayout(RealtimeStatus.paused),
      (
        primary: RealtimeControlAction.resume,
        secondary: RealtimeControlAction.end,
        busy: false,
      ),
    );
    expect(
      realtimeControlLayout(RealtimeStatus.ending),
      (primary: null, secondary: null, busy: true),
    );
    for (final status in [RealtimeStatus.ended, RealtimeStatus.failed]) {
      expect(
        realtimeControlLayout(status),
        (
          primary: RealtimeControlAction.startAgain,
          secondary: null,
          busy: false,
        ),
      );
    }
  });

  testWidgets('renders only valid actions with a stable primary slot',
      (tester) async {
    const labels = <String>{'开始', '取消', '暂停', '继续', '结束', '再次开始'};
    const expected = <RealtimeStatus, Set<String>>{
      RealtimeStatus.idle: {'开始'},
      RealtimeStatus.connecting: {'取消'},
      RealtimeStatus.active: {'暂停', '结束'},
      RealtimeStatus.paused: {'继续', '结束'},
      RealtimeStatus.ending: {},
      RealtimeStatus.ended: {'再次开始'},
      RealtimeStatus.failed: {'再次开始'},
    };
    double? primaryX;

    for (final entry in expected.entries) {
      await tester.pumpWidget(_TestApp(status: entry.key));
      for (final label in labels) {
        expect(
          find.text(label),
          entry.value.contains(label) ? findsOneWidget : findsNothing,
          reason: '${entry.key} should expose only ${entry.value}',
        );
      }
      if (entry.key == RealtimeStatus.ending) {
        expect(find.byType(CircularProgressIndicator), findsOneWidget);
        expect(find.byKey(const ValueKey('realtime-primary-action')),
            findsNothing);
        continue;
      }
      final currentX = tester
          .getCenter(find.byKey(const ValueKey('realtime-primary-action')))
          .dx;
      primaryX ??= currentX;
      expect(currentX, primaryX);
    }
  });

  testWidgets('dispatches start pause resume cancel and end commands',
      (tester) async {
    var starts = 0;
    var pauses = 0;
    var stops = 0;
    var preflights = 0;

    Future<void> pump(RealtimeStatus status) {
      return tester.pumpWidget(_TestApp(
        status: status,
        onStart: () async => starts += 1,
        onPause: () async => pauses += 1,
        onStop: () async => stops += 1,
        onBeforeStart: () async {
          preflights += 1;
          return true;
        },
      ));
    }

    await pump(RealtimeStatus.idle);
    await tester.tap(find.text('开始'));
    await tester.pump();
    await pump(RealtimeStatus.active);
    await tester.tap(find.text('暂停'));
    await tester.pump();
    await tester.tap(find.text('结束'));
    await tester.pump();
    await pump(RealtimeStatus.paused);
    await tester.tap(find.text('继续'));
    await tester.pump();
    await pump(RealtimeStatus.connecting);
    await tester.tap(find.text('取消'));
    await tester.pump();
    await pump(RealtimeStatus.failed);
    await tester.tap(find.text('再次开始'));
    await tester.pump();

    expect(starts, 3);
    expect(pauses, 1);
    expect(stops, 2);
    expect(preflights, 2);
  });

  testWidgets('keeps active controls accessible at 320dp and 200 percent text',
      (tester) async {
    tester.view.physicalSize = const Size(320, 568);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(const _TestApp(
      status: RealtimeStatus.active,
      textScale: 2,
    ));

    expect(tester.takeException(), isNull);
    expect(find.bySemanticsLabel('暂停'), findsOneWidget);
    expect(find.bySemanticsLabel('结束'), findsOneWidget);
    final primarySize =
        tester.getSize(find.byKey(const ValueKey('realtime-primary-action')));
    expect(primarySize.width, greaterThanOrEqualTo(60));
    expect(primarySize.height, greaterThanOrEqualTo(60));
  });
}

class _TestApp extends StatelessWidget {
  const _TestApp({
    required this.status,
    this.onStart,
    this.onPause,
    this.onStop,
    this.onBeforeStart,
    this.textScale = 1,
  });

  final RealtimeStatus status;
  final Future<void> Function()? onStart;
  final Future<void> Function()? onPause;
  final Future<void> Function()? onStop;
  final Future<bool> Function()? onBeforeStart;
  final double textScale;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      locale: const Locale('zh'),
      localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(textScale),
        ),
        child: child!,
      ),
      home: Scaffold(
        body: RealtimeControls(
          status: status,
          onStart: onStart ?? () async {},
          onPause: onPause ?? () async {},
          onStop: onStop ?? () async {},
          onBeforeStart: onBeforeStart,
        ),
      ),
    );
  }
}
