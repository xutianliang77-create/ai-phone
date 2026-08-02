import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/scan/presentation/controllers/scan_translation_controller.dart';
import 'package:translation_mobile/src/features/scan/presentation/widgets/scan_image_translation_view.dart';
import 'package:translation_mobile/src/features/scan/presentation/widgets/scan_text_comparison_view.dart';
import 'package:translation_mobile/src/features/scan/presentation/widgets/scan_translation_layout_policy.dart';
import 'package:translation_mobile/src/platform/ocr/mobile_ocr_provider.dart';

void main() {
  test('uses list fallback only for dense narrow OCR layouts', () {
    expect(shouldUseScanTranslationListFallback(_denseBlocks()), isTrue);
    expect(
      shouldUseScanTranslationListFallback(<ScanTranslatedBlock>[
        _block(0, width: 0.42),
        _block(1, width: 0.42),
        _block(2, width: 0.42),
      ]),
      isFalse,
    );
  });

  testWidgets('moves dense overlays into an expandable paired list',
      (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final blocks = _denseBlocks();
    final translatedText = blocks.map((block) => block.translation).join('\n');

    Widget app({required bool translated}) => MaterialApp(
          locale: const Locale('zh'),
          localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
            AppLocalizations.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
          ],
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: ListView(
              padding: const EdgeInsets.all(12),
              children: <Widget>[
                ScanImageTranslationView(
                  imageBytes: _whitePixel,
                  aspectRatio: 1.55,
                  translatedBlocks:
                      translated ? blocks : const <ScanTranslatedBlock>[],
                  translatedText: translated ? translatedText : '',
                ),
                if (translated)
                  ScanTextComparisonView(
                    sourceText:
                        blocks.map((block) => block.source.text).join('\n'),
                    translatedText: translatedText,
                    translatedBlocks: blocks,
                  ),
              ],
            ),
          ),
        );

    await tester.pumpWidget(app(translated: false));
    await tester.pumpWidget(app(translated: true));
    await tester.pumpAndSettle();

    expect(
      find.byKey(const ValueKey('scan-translation-list-fallback-notice')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('scan-translation-overlay-0')),
      findsNothing,
    );
    await tester.scrollUntilVisible(
      find.byKey(const ValueKey('scan-translation-list-item-0')),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    expect(
      find.byKey(const ValueKey('scan-translation-list-fallback')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('scan-translation-list-translation-0')),
      findsNothing,
    );

    await tester.tap(
      find.byKey(const ValueKey('scan-translation-list-item-0')),
    );
    await tester.pumpAndSettle();

    expect(
      find.byKey(const ValueKey('scan-translation-list-source-0')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('scan-translation-list-translation-0')),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
}

List<ScanTranslatedBlock> _denseBlocks() {
  return List<ScanTranslatedBlock>.generate(
    16,
    (index) => _block(index, width: 0.2),
  );
}

ScanTranslatedBlock _block(int index, {required double width}) {
  final column = index % 4;
  final row = index ~/ 4;
  return ScanTranslatedBlock(
    source: MobileOcrBlock(
      text: '单元格 ${index + 1}',
      left: 0.02 + column * 0.24,
      top: 0.02 + row * 0.23,
      width: width,
      height: 0.14,
    ),
    translation: 'Table item ${index + 1} with price',
  );
}

final _whitePixel = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
);
