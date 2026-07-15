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
}) {
  if (canvas.isEmpty) return const <ScanTranslationOverlayPlacement>[];
  final placements = <ScanTranslationOverlayPlacement>[];
  final occupied = <Rect>[];
  for (final block in blocks) {
    final source = _sourceRect(block, canvas);
    final fontSize = _fontSize(block.translation, source.height);
    final width =
        _overlayWidth(block.translation, source.width, fontSize, canvas);
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

double _fontSize(String text, double sourceHeight) {
  var size = (sourceHeight * 0.62).clamp(12.0, 18.0);
  final length = text.runes.length;
  if (length > 18) size -= 1.5;
  if (length > 36) size -= 1.5;
  if (length > 60) size -= 1;
  return size.clamp(10.0, 18.0);
}

double _overlayWidth(
  String text,
  double sourceWidth,
  double fontSize,
  Size canvas,
) {
  final characters = math.min(text.runes.length, 18);
  final estimated = characters * fontSize * 0.62 + 8;
  final minimum = math.min(72.0, canvas.width);
  final maximum = math.min(180.0, canvas.width);
  return math.max(sourceWidth, estimated).clamp(minimum, maximum);
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

Rect _nearestFreeRect(Rect preferred, List<Rect> occupied, Size canvas) {
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

Rect _nearestGridSlot(Rect preferred, List<Rect> occupied, Size canvas) {
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
  return best ?? preferred;
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
