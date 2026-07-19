import 'dart:math' as math;

import 'package:flutter/material.dart';

class InfinityAudioVisualizer extends StatefulWidget {
  const InfinityAudioVisualizer({
    required this.active,
    this.paused = false,
    super.key,
  });

  final bool active;
  final bool paused;

  @override
  State<InfinityAudioVisualizer> createState() =>
      _InfinityAudioVisualizerState();
}

class _InfinityAudioVisualizerState extends State<InfinityAudioVisualizer>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2200),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _syncAnimation();
  }

  @override
  void didUpdateWidget(covariant InfinityAudioVisualizer oldWidget) {
    super.didUpdateWidget(oldWidget);
    _syncAnimation();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return RepaintBoundary(
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) => CustomPaint(
          painter: _InfinityAudioPainter(
            progress: _controller.value,
            active: widget.active,
            paused: widget.paused,
            lineColor: colors.primary,
            signalColor: colors.secondary,
          ),
          size: Size.infinite,
        ),
      ),
    );
  }

  void _syncAnimation() {
    final reduceMotion =
        MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    if (widget.active && !widget.paused && !reduceMotion) {
      if (!_controller.isAnimating) _controller.repeat();
      return;
    }
    _controller.stop();
    if (!widget.active) _controller.value = 0;
  }
}

class _InfinityAudioPainter extends CustomPainter {
  const _InfinityAudioPainter({
    required this.progress,
    required this.active,
    required this.paused,
    required this.lineColor,
    required this.signalColor,
  });

  final double progress;
  final bool active;
  final bool paused;
  final Color lineColor;
  final Color signalColor;

  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    final width = math.min(size.width * 0.54, 320.0);
    final height = math.min(size.height * 0.28, 72.0);
    if (width <= 0 || height <= 0) return;

    final base = Path();
    for (var index = 0; index <= 180; index++) {
      final point = _point(index / 180, center, width, height);
      if (index == 0) {
        base.moveTo(point.dx, point.dy);
      } else {
        base.lineTo(point.dx, point.dy);
      }
    }
    canvas.drawPath(
      base,
      Paint()
        ..color = lineColor.withValues(alpha: 0.06)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 5
        ..strokeCap = StrokeCap.round,
    );
    canvas.drawPath(
      base,
      Paint()
        ..color = lineColor.withValues(alpha: 0.18)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.1
        ..strokeCap = StrokeCap.round,
    );

    if (!active || paused) {
      canvas.drawCircle(
        center,
        paused ? 2.5 : 3,
        Paint()..color = signalColor.withValues(alpha: paused ? 0.42 : 0.72),
      );
      return;
    }

    final head = _point(progress, center, width, height);
    canvas.drawCircle(
      head,
      9,
      Paint()..color = signalColor.withValues(alpha: 0.07),
    );
    for (var index = 5; index >= 0; index--) {
      final phase = (progress - index * 0.012) % 1;
      final point = _point(phase, center, width, height);
      final prominence = 1 - index / 6;
      canvas.drawCircle(
        point,
        1.4 + prominence * 2.8,
        Paint()
          ..color = signalColor.withValues(alpha: 0.12 + prominence * 0.72),
      );
    }
  }

  Offset _point(
    double phase,
    Offset center,
    double width,
    double height,
  ) {
    final angle = phase * math.pi * 2;
    final denominator = 1 + math.pow(math.cos(angle), 2);
    final x = math.sin(angle) / denominator;
    final y = math.sin(angle) * math.cos(angle) / denominator;
    return Offset(
      center.dx + x * width / 2,
      center.dy + y * height,
    );
  }

  @override
  bool shouldRepaint(covariant _InfinityAudioPainter oldDelegate) {
    return oldDelegate.progress != progress ||
        oldDelegate.active != active ||
        oldDelegate.paused != paused ||
        oldDelegate.lineColor != lineColor ||
        oldDelegate.signalColor != signalColor;
  }
}
