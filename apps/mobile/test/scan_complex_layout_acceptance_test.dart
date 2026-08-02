import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/scan/presentation/controllers/scan_translation_controller.dart';
import 'package:translation_mobile/src/features/scan/presentation/widgets/scan_image_translation_view.dart';
import 'package:translation_mobile/src/features/scan/presentation/widgets/scan_translation_overlay_layout.dart';
import 'package:translation_mobile/src/platform/ocr/mobile_ocr_provider.dart';

void main() {
  testWidgets(
      'keeps a bottom-right translation clear of zoom controls at large text',
      (tester) async {
    tester.view.physicalSize = const Size(320, 568);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final imageBytes = base64Decode(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    );
    const block = ScanTranslatedBlock(
      source: MobileOcrBlock(
        text: '右下角价格',
        left: 0.7,
        top: 0.8,
        width: 0.26,
        height: 0.1,
      ),
      translation: 'Bottom-right price label',
    );

    Widget app(String translation) => MaterialApp(
          locale: const Locale('zh'),
          theme: ThemeData.dark(),
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
                translatedBlocks:
                    translation.isEmpty ? const [] : const [block],
                translatedText: translation,
              ),
            ),
          ),
        );

    await tester.pumpWidget(app(''));
    await tester.pumpWidget(app(block.translation));
    await tester.pumpAndSettle();

    final overlay = tester.getRect(
      find.byKey(const ValueKey('scan-translation-overlay-0')),
    );
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
      expect(overlay.overlaps(control), isFalse, reason: '$icon obscures text');
    }
    final overlayText = tester.widget<Text>(find.text(block.translation));
    expect(overlayText.textScaler!.scale(10), 11);
    expect(tester.takeException(), isNull);
  });

  test('keeps menu table and skewed-document fixture matrices valid', () {
    final fixtures = <({
      String name,
      Size canvas,
      TextScaler textScaler,
      List<ScanTranslatedBlock> blocks,
    })>[
      (
        name: 'portrait-menu-200-percent',
        canvas: const Size(320, 480),
        textScaler: const TextScaler.linear(2),
        blocks: _menuBlocks(),
      ),
      (
        name: 'landscape-table-150-percent',
        canvas: const Size(568, 320),
        textScaler: const TextScaler.linear(1.5),
        blocks: _tableBlocks(),
      ),
      (
        name: 'portrait-skewed-document',
        canvas: const Size(320, 480),
        textScaler: TextScaler.noScaling,
        blocks: _skewedDocumentBlocks(),
      ),
      (
        name: 'landscape-skewed-document-200-percent',
        canvas: const Size(480, 320),
        textScaler: const TextScaler.linear(2),
        blocks: _skewedDocumentBlocks(),
      ),
    ];

    for (final fixture in fixtures) {
      final placements = layoutScanTranslationOverlays(
        blocks: fixture.blocks,
        canvas: fixture.canvas,
        textDirection: TextDirection.ltr,
        textScaler: fixture.textScaler,
      );
      expect(placements, hasLength(fixture.blocks.length),
          reason: fixture.name);
      for (var index = 0; index < placements.length; index++) {
        final placement = placements[index];
        expect(identical(placement.block, fixture.blocks[index]), isTrue,
            reason: fixture.name);
        expect(placement.fontSize, inInclusiveRange(8, 18),
            reason: fixture.name);
        expect(placement.rect.left, greaterThanOrEqualTo(0),
            reason: fixture.name);
        expect(placement.rect.top, greaterThanOrEqualTo(0),
            reason: fixture.name);
        expect(placement.rect.right, lessThanOrEqualTo(fixture.canvas.width),
            reason: fixture.name);
        expect(placement.rect.bottom, lessThanOrEqualTo(fixture.canvas.height),
            reason: fixture.name);
        for (var other = index + 1; other < placements.length; other++) {
          expect(placement.rect.overlaps(placements[other].rect), isFalse,
              reason: fixture.name);
        }
      }
    }
  });

  test('keeps dense-grid fallback outside reserved image controls', () {
    const reservedControls = Rect.fromLTWH(168, 184, 144, 48);
    final blocks = List<ScanTranslatedBlock>.generate(
      20,
      (index) => ScanTranslatedBlock(
        source: const MobileOcrBlock(
          text: '密集文字',
          left: 0.72,
          top: 0.8,
          width: 0.2,
          height: 0.1,
        ),
        translation: 'Dense translated label ${index + 1}',
      ),
    );
    final placements = layoutScanTranslationOverlays(
      blocks: blocks,
      canvas: const Size(320, 240),
      textDirection: TextDirection.ltr,
      textScaler: const TextScaler.linear(2),
      reservedRect: reservedControls,
    );

    expect(placements, hasLength(blocks.length));
    for (var index = 0; index < placements.length; index++) {
      expect(placements[index].rect.overlaps(reservedControls), isFalse);
      for (var other = index + 1; other < placements.length; other++) {
        expect(
          placements[index].rect.overlaps(placements[other].rect),
          isFalse,
        );
      }
    }
  });

  test('keeps representative iPhone overlays fully readable at large text', () {
    final fixtures =
        <({String name, Size canvas, List<ScanTranslatedBlock> blocks})>[
      (
        name: 'menu',
        canvas: const Size(369, 369 / 0.78),
        blocks: _menuBlocks(),
      ),
      (
        name: 'table',
        canvas: const Size(369, 369 / 1.55),
        blocks: _iphoneTableBlocks(),
      ),
      (
        name: 'skewed-document',
        canvas: const Size(369, 369 / 0.82),
        blocks: _skewedDocumentBlocks(),
      ),
    ];

    for (final fixture in fixtures) {
      final placements = layoutScanTranslationOverlays(
        blocks: fixture.blocks,
        canvas: fixture.canvas,
        textDirection: TextDirection.ltr,
        textScaler: const TextScaler.linear(1.1),
        reservedRect: Rect.fromLTWH(
          fixture.canvas.width - 152,
          fixture.canvas.height - 56,
          144,
          48,
        ),
      );
      for (final placement in placements) {
        final painter = TextPainter(
          text: TextSpan(
            text: placement.block.translation,
            style: TextStyle(
              fontSize: placement.fontSize,
              height: 1.1,
              fontWeight: FontWeight.w600,
            ),
          ),
          maxLines: scanTranslationOverlayMaxLines,
          ellipsis: '…',
          textDirection: TextDirection.ltr,
          textScaler: const TextScaler.linear(1.1),
        )..layout(maxWidth: placement.rect.width - 6);
        expect(
          painter.didExceedMaxLines,
          isFalse,
          reason:
              '${fixture.name}: ${placement.block.translation}; rect=${placement.rect}; font=${placement.fontSize}',
        );
        expect(
          _paintedHeight(painter, placement.block.translation),
          lessThanOrEqualTo(placement.rect.height - 4 + 0.01),
          reason:
              '${fixture.name}: ${placement.block.translation}; rect=${placement.rect}; font=${placement.fontSize}',
        );
      }
    }
  });
}

double _paintedHeight(TextPainter painter, String text) {
  final boxes = painter.getBoxesForSelection(
    TextSelection(baseOffset: 0, extentOffset: text.length),
  );
  return boxes.fold<double>(
    painter.height,
    (height, box) => math.max(height, box.bottom),
  );
}

List<ScanTranslatedBlock> _menuBlocks() {
  const sources = <String>['咖啡', '茶', '牛肉面', '招牌套餐', '甜点', '总价'];
  const translations = <String>[
    'Freshly brewed coffee',
    'Jasmine green tea',
    'Braised beef noodle soup',
    'Signature set with soup and seasonal fruit',
    'Chef selection dessert',
    'Total price including service charge',
  ];
  return List<ScanTranslatedBlock>.generate(sources.length, (index) {
    final column = index % 2;
    final row = index ~/ 2;
    return ScanTranslatedBlock(
      source: MobileOcrBlock(
        text: sources[index],
        left: 0.06 + column * 0.49,
        top: 0.08 + row * 0.27,
        width: 0.38,
        height: 0.1,
      ),
      translation: translations[index],
    );
  });
}

List<ScanTranslatedBlock> _tableBlocks() {
  return List<ScanTranslatedBlock>.generate(20, (index) {
    final column = index % 5;
    final row = index ~/ 5;
    return ScanTranslatedBlock(
      source: MobileOcrBlock(
        text: '字段 ${index + 1}',
        left: 0.02 + column * 0.195,
        top: 0.04 + row * 0.235,
        width: 0.17,
        height: 0.12,
      ),
      translation: 'Field ${index + 1} value',
    );
  });
}

List<ScanTranslatedBlock> _iphoneTableBlocks() {
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
  const sources = <String>['发票', '日期', '订单号', '小计', '服务费', '应付金额'];
  const translations = <String>[
    'Invoice',
    'Date: August 2, 2026',
    'Order number WJ-20260802',
    'Subtotal before tax',
    'Service charge',
    'Total amount due',
  ];
  return List<ScanTranslatedBlock>.generate(sources.length, (index) {
    return ScanTranslatedBlock(
      source: MobileOcrBlock(
        text: sources[index],
        left: 0.08 + index * 0.025,
        top: 0.06 + index * 0.145,
        width: index.isEven ? 0.58 : 0.46,
        height: 0.075,
      ),
      translation: translations[index],
    );
  });
}
