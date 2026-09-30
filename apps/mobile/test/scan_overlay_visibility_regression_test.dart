import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/scan/presentation/controllers/scan_translation_controller.dart';
import 'package:translation_mobile/src/features/scan/presentation/widgets/scan_image_translation_view.dart';
import 'package:translation_mobile/src/platform/ocr/mobile_ocr_provider.dart';

final _image = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
);

Widget _app(List<ScanTranslatedBlock> blocks, {bool scrollable = false}) =>
    MaterialApp(
      locale: const Locale('zh'),
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: scrollable
            ? ListView(children: [
                _imageView(blocks),
                const SizedBox(height: 1600),
                const Text('End of scan page'),
              ])
            : _imageView(blocks),
      ),
    );

Widget _imageView(List<ScanTranslatedBlock> blocks) => SizedBox(
      width: 360,
      child: ScanImageTranslationView(
        imageBytes: _image,
        aspectRatio: 1,
        translatedBlocks: blocks,
        translatedText: blocks.map((b) => b.translation).join('\n'),
      ),
    );

List<ScanTranslatedBlock> _blocks(int count) => List.generate(
      count,
      (index) => ScanTranslatedBlock(
        source: MobileOcrBlock(
          text: '测试 ${index + 1}',
          left: 0.02 + (index % 4) * 0.24,
          top: 0.02 + (index ~/ 4) * 0.23,
          width: 0.2,
          height: 0.14,
        ),
        translation: 'Translated item ${index + 1}',
      ),
    );

void main() {
  testWidgets('already translated image opens with its translation overlay',
      (tester) async {
    await tester.pumpWidget(_app(_blocks(1)));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('scan-translation-overlay-0')),
        findsOneWidget);
  });

  testWidgets('remount after scrolling away restores available overlay',
      (tester) async {
    final translated = _blocks(1);
    await tester.pumpWidget(_app(const []));
    await tester.pumpWidget(_app(translated));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('scan-translation-overlay-0')),
        findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpWidget(_app(translated));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('scan-translation-overlay-0')),
        findsOneWidget);
  });

  testWidgets('dense layout keeps overlays and its readable-list notice',
      (tester) async {
    await tester.pumpWidget(_app(const []));
    await tester.pumpWidget(_app(_blocks(16)));
    await tester.pumpAndSettle();
    for (var i = 0; i < 16; i++) {
      expect(
          find.byKey(ValueKey('scan-translation-overlay-$i')), findsOneWidget);
    }
    expect(find.byKey(const ValueKey('scan-translation-list-fallback-notice')),
        findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('explicit original-layer selection survives same-image updates',
      (tester) async {
    await tester.pumpWidget(_app(const []));
    await tester.pumpWidget(_app(_blocks(1)));
    await tester.pumpAndSettle();
    final layers = tester
        .widget<SegmentedButton<bool>>(find.byType(SegmentedButton<bool>));
    layers.onSelectionChanged!({false});
    await tester.pumpWidget(_app(_blocks(1)));
    await tester.pumpAndSettle();
    expect(
        find.byKey(const ValueKey('scan-translation-overlay-0')), findsNothing);
  });

  testWidgets('scrolling retains an explicit original-layer choice',
      (tester) async {
    await tester.pumpWidget(_app(_blocks(1), scrollable: true));
    await tester.pumpAndSettle();
    tester
        .widget<SegmentedButton<bool>>(find.byType(SegmentedButton<bool>))
        .onSelectionChanged!({false});
    await tester.pump();
    final imageState = tester.state(find.byType(ScanImageTranslationView));
    await tester.scrollUntilVisible(find.text('End of scan page'), 700);
    await tester.pumpAndSettle();
    expect(imageState.mounted, isTrue);
    await tester.drag(find.byType(ListView), const Offset(0, 2200));
    await tester.pumpAndSettle();
    expect(find.byType(ScanImageTranslationView), findsOneWidget);
    expect(
        find.byKey(const ValueKey('scan-translation-overlay-0')), findsNothing);
  });
}
