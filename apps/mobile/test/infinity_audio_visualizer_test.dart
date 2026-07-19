import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/presentation/widgets/infinity_audio_visualizer.dart';

void main() {
  testWidgets('animates only while realtime audio is active', (tester) async {
    Future<void> pump({required bool active, bool paused = false}) {
      return tester.pumpWidget(
        MaterialApp(
          home: SizedBox(
            width: 360,
            height: 180,
            child: InfinityAudioVisualizer(active: active, paused: paused),
          ),
        ),
      );
    }

    await pump(active: false);
    final finder = find.descendant(
      of: find.byType(InfinityAudioVisualizer),
      matching: find.byType(CustomPaint),
    );
    final idlePainter = tester.widget<CustomPaint>(finder).painter;
    await tester.pump(const Duration(milliseconds: 300));
    expect(tester.widget<CustomPaint>(finder).painter, same(idlePainter));

    await pump(active: true);
    final activePainter = tester.widget<CustomPaint>(finder).painter;
    await tester.pump(const Duration(milliseconds: 300));
    expect(
        tester.widget<CustomPaint>(finder).painter, isNot(same(activePainter)));

    await pump(active: true, paused: true);
    final pausedPainter = tester.widget<CustomPaint>(finder).painter;
    await tester.pump(const Duration(milliseconds: 300));
    expect(tester.widget<CustomPaint>(finder).painter, same(pausedPainter));
  });
}
