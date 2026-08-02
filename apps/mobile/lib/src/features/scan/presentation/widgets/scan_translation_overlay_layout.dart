import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../controllers/scan_translation_controller.dart';

class ScanTranslationOverlayPlacement {
  const ScanTranslationOverlayPlacement({
    required this.block,
    required this.rect,
    required this.fontSize,
  });

  final ScanTranslatedBlock block;
  final Rect rect;
  final double fontSize;
}

List<ScanTranslationOverlayPlacement> layoutScanTranslationOverlays({
  required List<ScanTranslatedBlock> blocks,
  required Size canvas,
  required TextDirection textDirection,
  required TextScaler textScaler,
  Rect? reservedRect,
}) {
  if (canvas.isEmpty) return const <ScanTranslationOverlayPlacement>[];
  final placements = <ScanTranslationOverlayPlacement>[];
  final occupied = <Rect>[if (reservedRect != null) reservedRect];
  for (final block in blocks) {
    final source = _sourceRect(block, canvas);
    final width = _overlayWidth(source.width, canvas);
    final fontSize = _fontSize(
      block.translation,
      sourceHeight: source.height,
      width: width,
      textScaler: textScaler,
    );
    final height = _overlayHeight(
      text: block.translation,
      width: width,
      sourceHeight: source.height,
      fontSize: fontSize,
      textDirection: textDirection,
      textScaler: textScaler,
      canvas: canvas,
    );
    final preferred = _clampRect(
      Rect.fromLTWH(source.left, source.top, width, height),
      canvas,
    );
    final rect = _nearestFreeRect(preferred, occupied, canvas);
    if (rect == null) {
      return _layoutDenseGrid(
        blocks: blocks,
        canvas: canvas,
        textDirection: textDirection,
        textScaler: textScaler,
        reservedRect: reservedRect,
      );
    }
    occupied.add(rect);
    placements.add(ScanTranslationOverlayPlacement(
      block: block,
      rect: rect,
      fontSize: fontSize,
    ));
  }
  return placements;
}

Rect _sourceRect(ScanTranslatedBlock block, Size canvas) {
  final bounds = block.source;
  final left = (bounds.left * canvas.width).clamp(0.0, canvas.width);
  final top = (bounds.top * canvas.height).clamp(0.0, canvas.height);
  final availableWidth = math.max(0.0, canvas.width - left);
  final availableHeight = math.max(0.0, canvas.height - top);
  final width = (bounds.width * canvas.width).clamp(0.0, availableWidth);
  final height = (bounds.height * canvas.height).clamp(0.0, availableHeight);
  return Rect.fromLTWH(left, top, width, height);
}

double _fontSize(
  String text, {
  required double sourceHeight,
  required double width,
  required TextScaler textScaler,
}) {
  var size = (sourceHeight * 0.62).clamp(12.0, 18.0);
  final length = text.runes.length;
  if (length > 18) size -= 1.5;
  if (length > 36) size -= 1.5;
  if (length > 60) size -= 1;
  if (length > 0) {
    final scaledGlyphWidth =
        _averageGlyphWidthFactor(text) * math.max(0.1, textScaler.scale(1));
    final widthBudget =
        math.max(1.0, width - 6) * 3 / (length * scaledGlyphWidth);
    size = math.min(size, widthBudget);
  }
  return size.clamp(10.0, 18.0);
}

double _overlayWidth(double sourceWidth, Size canvas) {
  final minimum = math.min(48.0, canvas.width);
  final maximum = math.min(180.0, canvas.width);
  return sourceWidth.clamp(minimum, maximum);
}

double _overlayHeight({
  required String text,
  required double width,
  required double sourceHeight,
  required double fontSize,
  required TextDirection textDirection,
  required TextScaler textScaler,
  required Size canvas,
}) {
  final painter = TextPainter(
    text: TextSpan(
      text: text,
      style: TextStyle(fontSize: fontSize, height: 1.1),
    ),
    maxLines: 3,
    textDirection: textDirection,
    textScaler: textScaler,
  )..layout(maxWidth: math.max(1, width - 6));
  final minimum = math.min(24.0, canvas.height);
  final maximum = math.max(minimum, math.min(canvas.height * 0.4, 120.0));
  return math.max(sourceHeight, painter.height + 4).clamp(minimum, maximum);
}

Rect? _nearestFreeRect(Rect preferred, List<Rect> occupied, Size canvas) {
  if (_isFree(preferred, occupied)) return preferred;
  const gap = 3.0;
  final candidates = <Rect>[];
  for (final rect in occupied) {
    candidates.addAll(<Rect>[
      Rect.fromLTWH(
          preferred.left, rect.bottom + gap, preferred.width, preferred.height),
      Rect.fromLTWH(preferred.left, rect.top - preferred.height - gap,
          preferred.width, preferred.height),
      Rect.fromLTWH(
          rect.right + gap, preferred.top, preferred.width, preferred.height),
      Rect.fromLTWH(rect.left - preferred.width - gap, preferred.top,
          preferred.width, preferred.height),
    ]);
  }
  candidates.sort((a, b) => _distanceSquared(a.topLeft, preferred.topLeft)
      .compareTo(_distanceSquared(b.topLeft, preferred.topLeft)));
  for (final candidate in candidates) {
    if (_inside(candidate, canvas) && _isFree(candidate, occupied)) {
      return candidate;
    }
  }
  return _nearestGridSlot(preferred, occupied, canvas);
}

Rect? _nearestGridSlot(Rect preferred, List<Rect> occupied, Size canvas) {
  Rect? best;
  var bestDistance = double.infinity;
  for (var top = 0.0; top <= canvas.height - preferred.height; top += 4) {
    for (var left = 0.0; left <= canvas.width - preferred.width; left += 4) {
      final candidate = Rect.fromLTWH(
        left,
        top,
        preferred.width,
        preferred.height,
      );
      if (!_isFree(candidate, occupied)) continue;
      final distance = _distanceSquared(candidate.topLeft, preferred.topLeft);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
  }
  return best;
}

List<ScanTranslationOverlayPlacement> _layoutDenseGrid({
  required List<ScanTranslatedBlock> blocks,
  required Size canvas,
  required TextDirection textDirection,
  required TextScaler textScaler,
  required Rect? reservedRect,
}) {
  final count = blocks.length;
  if (count == 0) return const <ScanTranslationOverlayPlacement>[];
  final ordered = List.generate(
    count,
    (index) => (index: index, source: _sourceRect(blocks[index], canvas)),
  )..sort((left, right) {
      final vertical = left.source.top.compareTo(right.source.top);
      return vertical != 0
          ? vertical
          : left.source.left.compareTo(right.source.left);
    });
  final aspectRatio = canvas.width / math.max(1.0, canvas.height);
  final columns = math.max(
    1,
    math.min(count, math.sqrt(count * aspectRatio).ceil()),
  );
  const gap = 2.0;
  var rows = (count / columns).ceil();
  var availableCells = <Rect>[];
  while (availableCells.length < count) {
    final cellWidth = canvas.width / columns;
    final cellHeight = canvas.height / rows;
    availableCells = <Rect>[];
    for (var rank = 0; rank < rows * columns; rank++) {
      final column = rank % columns;
      final row = rank ~/ columns;
      final rect = Rect.fromLTWH(
        column * cellWidth + gap / 2,
        row * cellHeight + gap / 2,
        math.max(1, cellWidth - gap),
        math.max(1, cellHeight - gap),
      );
      if (reservedRect == null || !rect.inflate(1).overlaps(reservedRect)) {
        availableCells.add(rect);
      }
    }
    if (availableCells.length < count) rows += 1;
  }
  final rects = List<Rect?>.filled(count, null);
  for (var rank = 0; rank < ordered.length; rank++) {
    rects[ordered[rank].index] = availableCells[rank];
  }
  return List.generate(count, (index) {
    final rect = rects[index]!;
    return ScanTranslationOverlayPlacement(
      block: blocks[index],
      rect: rect,
      fontSize: _denseFontSize(
        blocks[index].translation,
        rect: rect,
        textDirection: textDirection,
        textScaler: textScaler,
      ),
    );
  });
}

double _denseFontSize(
  String text, {
  required Rect rect,
  required TextDirection textDirection,
  required TextScaler textScaler,
}) {
  var size = math.min(14.0, math.max(8.0, (rect.height - 4) / 1.1));
  while (size > 8) {
    final painter = TextPainter(
      text: TextSpan(text: text, style: TextStyle(fontSize: size, height: 1.1)),
      maxLines: 3,
      textDirection: textDirection,
      textScaler: textScaler,
    )..layout(maxWidth: math.max(1, rect.width - 6));
    if (!painter.didExceedMaxLines && painter.height <= rect.height - 4) {
      return size;
    }
    size -= 1;
  }
  return 8;
}

double _averageGlyphWidthFactor(String text) {
  final runes = text.runes;
  if (runes.isEmpty) return 0.62;
  var total = 0.0;
  for (final rune in runes) {
    total += rune > 0x2ff ? 1 : 0.58;
  }
  return total / runes.length;
}

bool _isFree(Rect candidate, List<Rect> occupied) {
  return occupied.every((rect) => !candidate.inflate(1).overlaps(rect));
}

bool _inside(Rect rect, Size canvas) {
  return rect.left >= 0 &&
      rect.top >= 0 &&
      rect.right <= canvas.width &&
      rect.bottom <= canvas.height;
}

Rect _clampRect(Rect rect, Size canvas) {
  final width = math.min(rect.width, canvas.width);
  final height = math.min(rect.height, canvas.height);
  return Rect.fromLTWH(
    rect.left.clamp(0.0, canvas.width - width),
    rect.top.clamp(0.0, canvas.height - height),
    width,
    height,
  );
}

double _distanceSquared(Offset left, Offset right) {
  final dx = left.dx - right.dx;
  final dy = left.dy - right.dy;
  return dx * dx + dy * dy;
}
