import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/scan/presentation/controllers/scan_translation_controller.dart';
import 'package:translation_mobile/src/features/scan/presentation/widgets/scan_image_translation_view.dart';
import 'package:translation_mobile/src/features/scan/presentation/widgets/scan_translation_overlay_layout.dart';
import 'package:translation_mobile/src/platform/ocr/mobile_ocr_provider.dart';

void main() {
  testWidgets('keeps translated text readable and zooms the combined canvas',
      (tester) async {
    final imageBytes = base64Decode(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    );

    Widget app(String translatedText) {
      return MaterialApp(
        locale: const Locale('zh'),
        localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: SizedBox(
            width: 360,
            child: ScanImageTranslationView(
              imageBytes: imageBytes,
              aspectRatio: 1,
              translatedText: translatedText,
              translatedBlocks: translatedText.isEmpty
                  ? const <ScanTranslatedBlock>[]
                  : <ScanTranslatedBlock>[
                      ScanTranslatedBlock(
                        source: const MobileOcrBlock(
                          text: '可读文字',
                          left: 0.1,
                          top: 0.2,
                          width: 0.5,
                          height: 0.1,
                        ),
                        translation: translatedText,
                      ),
                    ],
            ),
          ),
        ),
      );
    }

    await tester.pumpWidget(app(''));
    await tester.pumpWidget(app('Readable translated text'));
    await tester.pumpAndSettle();

    final translatedLabel = tester.widget<Text>(
      find.text('Readable translated text'),
    );
    expect(translatedLabel.style?.fontSize, inInclusiveRange(10, 18));

    var viewer =
        tester.widget<InteractiveViewer>(find.byType(InteractiveViewer));
    expect(viewer.transformationController!.value.getMaxScaleOnAxis(), 1);

    await tester.tap(find.byIcon(Icons.zoom_in));
    await tester.pump();
    viewer = tester.widget<InteractiveViewer>(find.byType(InteractiveViewer));
    expect(viewer.transformationController!.value.getMaxScaleOnAxis(), 1.5);

    await tester.tap(find.byIcon(Icons.center_focus_strong));
    await tester.pump();
    viewer = tester.widget<InteractiveViewer>(find.byType(InteractiveViewer));
    expect(viewer.transformationController!.value.getMaxScaleOnAxis(), 1);
  });

  testWidgets('separates dense blocks and adapts overlay text size',
      (tester) async {
    tester.view.physicalSize = const Size(320, 568);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final imageBytes = base64Decode(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    );
    final blocks = <ScanTranslatedBlock>[
      _block('茶', 'Tea', left: 0.08, top: 0.14),
      _block(
        '本店招牌套餐',
        'Signature set meal with soup and seasonal fruit',
        left: 0.22,
        top: 0.15,
      ),
      _block('价格', 'Price', left: 0.1, top: 0.22),
    ];

    Widget app(String translatedText) => MaterialApp(
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
              textScaler: const TextScaler.linear(2),
            ),
            child: child!,
          ),
          home: Scaffold(
            body: SizedBox(
              width: 320,
              child: ScanImageTranslationView(
                imageBytes: imageBytes,
                aspectRatio: 1,
                translatedText: translatedText,
                translatedBlocks: translatedText.isEmpty ? const [] : blocks,
              ),
            ),
          ),
        );

    await tester.pumpWidget(app(''));
    await tester
        .pumpWidget(app(blocks.map((block) => block.translation).join('\n')));
    await tester.pumpAndSettle();

    final overlayRects = List<Rect>.generate(
      blocks.length,
      (index) => tester.getRect(
        find.byKey(ValueKey('scan-translation-overlay-$index')),
      ),
    );
    for (var index = 0; index < overlayRects.length; index++) {
      for (var other = index + 1; other < overlayRects.length; other++) {
        expect(overlayRects[index].overlaps(overlayRects[other]), isFalse);
      }
    }
    final shortStyle = tester.widget<Text>(find.text('Tea')).style!;
    final longStyle = tester
        .widget<Text>(
          find.text('Signature set meal with soup and seasonal fruit'),
        )
        .style!;
    expect(longStyle.fontSize, lessThan(shortStyle.fontSize!));
    expect(longStyle.fontSize, greaterThanOrEqualTo(10));
    expect(tester.takeException(), isNull);
  });

  test('clamps out-of-range OCR bounds to the image canvas', () {
    final placements = layoutScanTranslationOverlays(
      blocks: <ScanTranslatedBlock>[
        const ScanTranslatedBlock(
          source: MobileOcrBlock(
            text: '边缘文字',
            left: 1.2,
            top: -0.2,
            width: 0.3,
            height: 0.1,
          ),
          translation: 'Edge text',
        ),
      ],
      canvas: const Size(320, 240),
      textDirection: TextDirection.ltr,
      textScaler: TextScaler.noScaling,
    );

    expect(placements, hasLength(1));
    expect(placements.single.rect.left, greaterThanOrEqualTo(0));
    expect(placements.single.rect.top, greaterThanOrEqualTo(0));
    expect(placements.single.rect.right, lessThanOrEqualTo(320));
    expect(placements.single.rect.bottom, lessThanOrEqualTo(240));
  });
}

ScanTranslatedBlock _block(
  String source,
  String translation, {
  required double left,
  required double top,
}) {
  return ScanTranslatedBlock(
    source: MobileOcrBlock(
      text: source,
      left: left,
      top: top,
      width: 0.18,
      height: 0.07,
    ),
    translation: translation,
  );
}
