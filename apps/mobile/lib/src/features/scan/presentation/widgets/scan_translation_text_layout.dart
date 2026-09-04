import 'dart:math' as math;

import 'package:flutter/material.dart';

const int scanTranslationOverlayMaxLines = 4;

TextPainter layoutScanTranslationText({
  required String text,
  required double fontSize,
  required double maxWidth,
  required TextDirection textDirection,
  required TextScaler textScaler,
}) {
  return TextPainter(
    text: TextSpan(
      text: text,
      style: TextStyle(
        fontSize: fontSize,
        height: 1.1,
        fontWeight: FontWeight.w600,
      ),
    ),
    maxLines: scanTranslationOverlayMaxLines,
    ellipsis: '…',
    textDirection: textDirection,
    textScaler: textScaler,
  )..layout(maxWidth: math.max(1, maxWidth));
}

double paintedScanTranslationTextHeight(TextPainter painter, String text) {
  if (text.isEmpty) return painter.height;
  final boxes = painter.getBoxesForSelection(
    TextSelection(baseOffset: 0, extentOffset: text.length),
  );
  return boxes.fold<double>(
    painter.height,
    (height, box) => math.max(height, box.bottom),
  );
}
