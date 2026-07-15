import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/scan/presentation/controllers/scan_translation_controller.dart';
import 'package:translation_mobile/src/features/scan/presentation/widgets/scan_image_translation_view.dart';
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
    expect(translatedLabel.style?.fontSize, 14);

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
}
