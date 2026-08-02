import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:path_provider/path_provider.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/scan/presentation/controllers/scan_translation_controller.dart';
import 'package:translation_mobile/src/features/scan/presentation/widgets/scan_image_translation_view.dart';
import 'package:translation_mobile/src/platform/ocr/mobile_ocr_provider.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('renders menu table and skewed-document overlays on iPhone',
      (tester) async {
    final screenshots = <String>[];
    for (final fixture in _fixtures()) {
      await tester.pumpWidget(_FixtureApp(
        aspectRatio: fixture.aspectRatio,
        blocks: const <ScanTranslatedBlock>[],
        dark: fixture.dark,
      ));
      await tester.pumpWidget(_FixtureApp(
        aspectRatio: fixture.aspectRatio,
        blocks: fixture.blocks,
        dark: fixture.dark,
      ));
      await tester.pumpAndSettle();

      _expectReadableAndCollisionFree(tester, fixture.name, fixture.blocks);
      final screenshotName = 'scan-${fixture.name}';
      final bytes = await binding.takeScreenshot(screenshotName);
      final directory = await getApplicationDocumentsDirectory();
      final screenshot = File('${directory.path}/$screenshotName.png');
      await screenshot.writeAsBytes(bytes, flush: true);
      screenshots.add(screenshot.path);
    }

    debugPrint('SCAN_LAYOUT_DEVICE_RESULT ${jsonEncode(<String, Object?>{
          'fixtures': <String>['menu', 'table', 'skewed-document'],
          'textScale': 2,
          'collisionFree': true,
          'zoomControlsClear': true,
          'screenshots': screenshots,
        })}');
  });
}

class _FixtureApp extends StatelessWidget {
  const _FixtureApp({
    required this.aspectRatio,
    required this.blocks,
    required this.dark,
  });

  final double aspectRatio;
  final List<ScanTranslatedBlock> blocks;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final translatedText = blocks.map((block) => block.translation).join('\n');
    return MaterialApp(
      locale: const Locale('zh'),
      theme: dark ? ThemeData.dark() : ThemeData.light(),
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
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: ScanImageTranslationView(
              imageBytes: _whitePixel,
              aspectRatio: aspectRatio,
              translatedBlocks: blocks,
              translatedText: translatedText,
            ),
          ),
        ),
      ),
    );
  }
}

void _expectReadableAndCollisionFree(
  WidgetTester tester,
  String fixtureName,
  List<ScanTranslatedBlock> blocks,
) {
  final overlayRects = <Rect>[
    for (var index = 0; index < blocks.length; index += 1)
      tester.getRect(
        find.byKey(ValueKey('scan-translation-overlay-$index')),
      ),
  ];
  for (var index = 0; index < blocks.length; index += 1) {
    final translation = blocks[index].translation;
    final paragraph = tester.renderObject<RenderParagraph>(
      find.text(translation),
    );
    final lastGlyphBoxes = paragraph.getBoxesForSelection(
      TextSelection(
        baseOffset: translation.length - 1,
        extentOffset: translation.length,
      ),
    );
    final reason =
        '$fixtureName: $translation; rect=${overlayRects[index]}; paragraph=${paragraph.size}; lastGlyph=$lastGlyphBoxes';
    expect(paragraph.didExceedMaxLines, isFalse, reason: reason);
    expect(lastGlyphBoxes, isNotEmpty, reason: reason);
    expect(
      lastGlyphBoxes.last.bottom,
      lessThanOrEqualTo(paragraph.size.height + 2),
      reason: reason,
    );
    expect(
      paragraph.size.height,
      lessThanOrEqualTo(overlayRects[index].height - 4 + 0.01),
      reason: reason,
    );
  }
  for (var index = 0; index < overlayRects.length; index += 1) {
    for (var other = index + 1; other < overlayRects.length; other += 1) {
      expect(
        overlayRects[index].overlaps(overlayRects[other]),
        isFalse,
      );
    }
  }
  for (final icon in const <IconData>[
    Icons.zoom_out,
    Icons.center_focus_strong,
    Icons.zoom_in,
  ]) {
    final control = tester.getRect(
      find.ancestor(
        of: find.byIcon(icon),
        matching: find.byType(IconButton),
      ),
    );
    for (final overlay in overlayRects) {
      expect(overlay.overlaps(control), isFalse);
    }
  }
  expect(tester.takeException(), isNull);
}

List<
    ({
      String name,
      double aspectRatio,
      bool dark,
      List<ScanTranslatedBlock> blocks,
    })> _fixtures() {
  return <({
    String name,
    double aspectRatio,
    bool dark,
    List<ScanTranslatedBlock> blocks,
  })>[
    (
      name: 'menu',
      aspectRatio: 0.78,
      dark: true,
      blocks: _menuBlocks(),
    ),
    (
      name: 'table',
      aspectRatio: 1.55,
      dark: false,
      blocks: _tableBlocks(),
    ),
    (
      name: 'skewed-document',
      aspectRatio: 0.82,
      dark: false,
      blocks: _skewedDocumentBlocks(),
    ),
  ];
}

List<ScanTranslatedBlock> _menuBlocks() {
  const source = <String>['咖啡', '茶', '牛肉面', '招牌套餐', '甜点', '总价'];
  const translation = <String>[
    'Freshly brewed coffee',
    'Jasmine green tea',
    'Braised beef noodle soup',
    'Signature set with soup and seasonal fruit',
    'Chef selection dessert',
    'Total price including service charge',
  ];
  return List<ScanTranslatedBlock>.generate(source.length, (index) {
    final column = index % 2;
    final row = index ~/ 2;
    return ScanTranslatedBlock(
      source: MobileOcrBlock(
        text: source[index],
        left: 0.06 + column * 0.49,
        top: 0.08 + row * 0.27,
        width: 0.38,
        height: 0.1,
      ),
      translation: translation[index],
    );
  });
}

List<ScanTranslatedBlock> _tableBlocks() {
  return List<ScanTranslatedBlock>.generate(16, (index) {
    final column = index % 4;
    final row = index ~/ 4;
    return ScanTranslatedBlock(
      source: MobileOcrBlock(
        text: '单元格 ${index + 1}',
        left: 0.02 + column * 0.24,
        top: 0.02 + row * 0.23,
        width: 0.2,
        height: 0.14,
      ),
      translation: 'Table item ${index + 1} with price',
    );
  });
}

List<ScanTranslatedBlock> _skewedDocumentBlocks() {
  const source = <String>['发票', '日期', '订单号', '小计', '服务费', '应付金额'];
  const translation = <String>[
    'Invoice',
    'Date: August 2, 2026',
    'Order number WJ-20260802',
    'Subtotal before tax',
    'Service charge',
    'Total amount due',
  ];
  return List<ScanTranslatedBlock>.generate(source.length, (index) {
    return ScanTranslatedBlock(
      source: MobileOcrBlock(
        text: source[index],
        left: 0.08 + index * 0.025,
        top: 0.06 + index * 0.145,
        width: index.isEven ? 0.58 : 0.46,
        height: 0.075,
      ),
      translation: translation[index],
    );
  });
}

final _whitePixel = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
);
